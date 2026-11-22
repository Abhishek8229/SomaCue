// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  reports: [] as Row[],
  progress: [] as Row[],
  pain: [] as Row[],
  logged: [] as Row[],
  failWrites: false,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    clinicalReport: {
      findMany: async () => db.reports,
      findFirst: async () => [...db.reports].sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime())[0] ?? null,
    },
    dailyProgress: { findMany: async () => db.progress },
    painEvent: { findMany: async () => db.pain },
    recoveryEvent: {
      findMany: async () => db.logged,
      upsert: async ({ where, create }: { where: { patientId_dedupeKey: { dedupeKey: string } }; create: Row }) => {
        if (db.failWrites) throw new Error("database unavailable");
        if (!db.logged.some((row) => row.dedupeKey === where.patientId_dedupeKey.dedupeKey)) {
          db.logged.push({ ...create, id: `row-${db.logged.length + 1}`, clinicalReportId: create.clinicalReportId ?? null, meta: create.meta ?? null });
        }
        return create;
      },
    },
  },
}));

import { getRecoveryTimeline, recordAnalysis, recordChatInsight, recordRecoveryEvent } from "@/lib/recovery/server";
import { analysisEvent } from "@/lib/recovery/timeline";

const STEPS = [
  { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
  { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
  { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
];
const user = { id: "patient-1", name: "Asha Rao", email: "asha@example.com" };
const NOW = new Date("2026-11-10T09:00:00Z"); // Day 10 of a plan that started Nov 1

function legacyReport(): Row {
  return {
    id: "report-1",
    patientId: "patient-1",
    createdAt: new Date("2026-11-01T08:00:00Z"),
    primarySymptoms: "Low back pain after lifting",
    conditionTitle: "Likely lower lumbar disc bulge",
    conditionSummary: "A bulging disc in the lower spine.",
    requiresInPersonCare: false,
    careReason: null,
    escalatedAt: null,
    escalationReason: null,
    treatmentPlan: {
      createdAt: new Date("2026-11-01T08:10:00Z"),
      routine: {
        durationMonths: 2,
        phases: [
          { phase: "Calm", tagline: "Settle the irritated tissue" },
          { phase: "Build", tagline: "Add strength and range" },
        ],
        steps: STEPS,
        startDateKey: "2026-11-01",
        skippedDays: ["2026-11-03"],
      },
      // an account made before precautions existed
      permanentPrecautions: null,
      dynamicPrecautions: null,
    },
  };
}

beforeEach(() => {
  db.reports = [legacyReport()];
  db.progress = [
    { clinicalReportId: "report-1", dateKey: "2026-11-02", completedExercises: ["Glute Bridge"], completedAt: new Date("2026-11-02T10:00:00Z"), feedback: "relief", notes: null, discomfortExercises: [], discomfortDetails: null, rescheduledAt: null, updatedAt: new Date("2026-11-02T10:00:00Z") },
  ];
  db.pain = [
    { id: "p1", clinicalReportId: "report-1", dateKey: "2026-11-05", painType: "sharp_pain", regions: ["lumbar"], exerciseNames: ["Glute Bridge"], details: "Caught as I lifted.", createdAt: new Date("2026-11-05T10:00:00Z"), rescheduledAt: null },
  ];
  db.logged = [];
  db.failWrites = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getRecoveryTimeline for an existing account with an empty log (backfill)", () => {
  it("builds the whole journey at once from the stored reports, plan, daily logs and pain events", async () => {
    const timeline = await getRecoveryTimeline(user, NOW);
    const titles = timeline.events.map((event) => event.title);

    expect(titles[0]).toBe("First analysis: Likely lower lumbar disc bulge");
    expect(titles).toEqual(
      expect.arrayContaining([
        "Treatment plan created",
        "Feeling better after the session",
        "Session completed",
        "Missed day: the plan moved forward",
        "Pain Override: the session was stopped",
        "Week 2 began: Calm phase",
      ]),
    );
    // oldest first
    const times = timeline.events.map((event) => event.occurredAt);
    expect([...times].sort()).toEqual(times);
    expect(db.logged).toHaveLength(0); // reading writes nothing
  });

  it("reports the current condition, plan position, trends and (when saved) precautions", async () => {
    const timeline = await getRecoveryTimeline(user, NOW);
    expect(timeline.patient).toEqual({ name: "Asha Rao", email: "asha@example.com" });
    expect(timeline.condition).toMatchObject({ title: "Likely lower lumbar disc bulge", symptoms: "Low back pain after lifting", startedAt: "2026-11-01T08:00:00.000Z" });
    expect(timeline.plan).toMatchObject({ durationMonths: 2, dayNumber: 10, weekNumber: 2, phaseName: "Calm" });
    expect(timeline.trends).toMatchObject({ sessionsCompleted: 1, painOverrides: 1, missedDays: 1, feedback: { relief: 1, same: 0, issue: 0 } });
    expect(timeline.precautions).toBeNull(); // this legacy plan has none saved yet

    (db.reports[0].treatmentPlan as Row).permanentPrecautions = ["Avoid loaded forward bending.", "Keep a neutral spine.", "Stop for leg numbness."];
    const withPrecautions = await getRecoveryTimeline(user, NOW);
    expect(withPrecautions.precautions?.permanent).toHaveLength(3);
  });

  it("works for a user with no intake yet", async () => {
    db.reports = [];
    db.progress = [];
    db.pain = [];
    const timeline = await getRecoveryTimeline(user, NOW);
    expect(timeline).toMatchObject({ events: [], condition: null, plan: null, precautions: null });
  });

  it("merges logged entries (chat updates, an earlier plan) without repeating a fact", async () => {
    await recordChatInsight("patient-1", { id: "msg-1", reportId: "report-1", content: "My back hurts when I sit for long.", createdAt: new Date("2026-11-08T10:00:00Z") });
    await recordRecoveryEvent("patient-1", analysisEvent({ id: "report-1", createdAt: new Date("2026-11-01T08:00:00Z"), primarySymptoms: "Low back pain after lifting", conditionTitle: "Likely lower lumbar disc bulge", conditionSummary: null, isFirst: true }));

    const timeline = await getRecoveryTimeline(user, NOW);
    expect(timeline.events.filter((event) => event.kind === "analysis")).toHaveLength(1);
    expect(timeline.events.find((event) => event.kind === "chat_insight")).toMatchObject({
      title: "Pain trigger mentioned in chat",
      detail: '"My back hurts when I sit for long."',
    });
    expect(timeline.trends.chatInsights).toBe(1);
  });
});

describe("recording events", () => {
  it("saves a fact once, however many times it is logged", async () => {
    const event = analysisEvent({ id: "report-1", createdAt: new Date("2026-11-01T08:00:00Z"), primarySymptoms: "Back pain", conditionTitle: "Disc bulge", conditionSummary: null, isFirst: true });
    expect(await recordRecoveryEvent("patient-1", event)).toBe(true);
    expect(await recordRecoveryEvent("patient-1", event)).toBe(true);
    expect(db.logged).toHaveLength(1);
    expect(db.logged[0]).toMatchObject({ dedupeKey: "analysis:report-1", kind: "analysis", patientId: "patient-1" });
  });

  it("marks a patient's first report as the first analysis and later ones as new", async () => {
    db.reports = [legacyReport()];
    await recordAnalysis("patient-1", { id: "report-1", createdAt: new Date("2026-11-01T08:00:00Z"), primarySymptoms: "Back pain", conditionTitle: "Disc bulge", conditionSummary: "Summary." });
    await recordAnalysis("patient-1", { id: "report-2", createdAt: new Date("2026-11-20T08:00:00Z"), primarySymptoms: "Knee pain", conditionTitle: "Knee strain", conditionSummary: null });
    expect(db.logged.map((row) => row.title)).toEqual(["First analysis: Disc bulge", "New analysis: Knee strain"]);
  });

  it("never throws when the database fails", async () => {
    db.failWrites = true;
    const event = analysisEvent({ id: "report-1", createdAt: new Date(), primarySymptoms: "x", conditionTitle: "T", conditionSummary: null, isFirst: true });
    await expect(recordRecoveryEvent("patient-1", event)).resolves.toBe(false);
    await expect(recordChatInsight("patient-1", { id: "m", reportId: null, content: "My knee hurts when I bend.", createdAt: new Date() })).resolves.toBe(false);
  });
});

describe("recordChatInsight", () => {
  it("logs useful updates and skips the rest", async () => {
    expect(await recordChatInsight("patient-1", { id: "m1", reportId: "report-1", content: "Thanks, that is clear!", createdAt: new Date() })).toBe(false);
    expect(await recordChatInsight("patient-1", { id: "m2", reportId: "report-1", content: "What is a disc bulge?", createdAt: new Date() })).toBe(false);
    expect(await recordChatInsight("patient-1", { id: "m3", reportId: "report-1", content: "I can walk to the shop now without pain.", createdAt: new Date() })).toBe(true);
    expect(db.logged.map((row) => row.title)).toEqual(["Improvement mentioned in chat"]);
  });

  it("keeps a warning-sign message even when its wording is not a plain symptom statement", async () => {
    expect(await recordChatInsight("patient-1", { id: "m4", reportId: null, content: "Lost control of my bladder this morning", createdAt: new Date() }, { redFlag: true })).toBe(true);
    expect(db.logged[0]).toMatchObject({ kind: "chat_insight", clinicalReportId: null });
  });
});
