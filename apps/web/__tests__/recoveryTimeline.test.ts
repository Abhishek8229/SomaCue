import { describe, expect, it } from "vitest";
import {
  adjustEvent,
  analysisEvent,
  deriveRecoveryEvents,
  feedbackEvent,
  mergeRecoveryEvents,
  planEvent,
  summarizeTrends,
  toneOf,
  type DerivedReport,
  type RecoveryEvent,
} from "@/lib/recovery/timeline";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import type { DynamicPrecautions } from "@/lib/precautions/precautions";

const STEPS = [
  { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
  { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
  { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
];

function plan(extra: Partial<StoredTreatmentPlan> = {}): StoredTreatmentPlan {
  return {
    durationMonths: 2,
    phases: [
      { phase: "Calm", tagline: "Settle the irritated tissue" },
      { phase: "Build", tagline: "Add strength and range" },
    ],
    steps: STEPS,
    startDateKey: "2026-11-01",
    ...extra,
  } as StoredTreatmentPlan;
}

function report(extra: Partial<DerivedReport> = {}): DerivedReport {
  return {
    id: "report-1",
    createdAt: new Date("2026-11-01T08:00:00Z"),
    primarySymptoms: "Low back pain after lifting",
    conditionTitle: "Likely lower lumbar disc bulge",
    conditionSummary: "A bulging disc in the lower spine.",
    escalatedAt: null,
    escalationReason: null,
    plan: plan(),
    planCreatedAt: new Date("2026-11-01T08:10:00Z"),
    dynamic: null,
    ...extra,
  };
}

const keys = (events: RecoveryEvent[]) => events.map((event) => event.key);
const NO_ACTIVITY = { progress: [], painEvents: [] };

describe("deriveRecoveryEvents: the timeline for an account that predates the log", () => {
  it("starts with the first analysis (condition and symptoms) and the initial plan", () => {
    const events = deriveRecoveryEvents({ reports: [report()], ...NO_ACTIVITY }, "2026-11-03");
    const first = events.find((event) => event.key === "analysis:report-1")!;
    expect(first.title).toBe("First analysis: Likely lower lumbar disc bulge");
    expect(first.detail).toContain("A bulging disc in the lower spine.");
    expect(first.detail).toContain("Symptoms reported: Low back pain after lifting");

    const created = events.find((event) => event.kind === "plan")!;
    expect(created.title).toBe("Treatment plan created");
    expect(created.detail).toBe("2-month plan: Calm, Build. Starts with Glute Bridge, Gentle Cat Cow, Ankle Pumps.");
  });

  it("calls only the earliest report the first analysis; later intakes are new analyses", () => {
    const later = report({ id: "report-2", createdAt: new Date("2026-11-20T08:00:00Z"), planCreatedAt: null, plan: null, conditionTitle: "Knee strain" });
    const events = deriveRecoveryEvents({ reports: [later, report()], ...NO_ACTIVITY }, "2026-11-21");
    expect(events.find((event) => event.key === "analysis:report-1")?.title).toMatch(/^First analysis/);
    expect(events.find((event) => event.key === "analysis:report-2")?.title).toBe("New analysis: Knee strain");
  });

  it("adds week and month progressions up to today, never past it", () => {
    const events = deriveRecoveryEvents({ reports: [report()], ...NO_ACTIVITY }, "2026-12-05"); // Day 35
    const weeks = events.filter((event) => event.kind === "week");
    expect(keys(weeks)).toEqual(["week:report-1:2", "week:report-1:3", "week:report-1:4", "week:report-1:5", "phase:report-1:1"]);
    expect(weeks.find((event) => event.key === "week:report-1:2")).toMatchObject({ title: "Week 2 began: Calm phase", dateKey: "2026-11-08" });
    expect(weeks.find((event) => event.key === "phase:report-1:1")).toMatchObject({
      title: "Month 2 began: Build",
      detail: "Add strength and range",
      dateKey: "2026-12-01",
    });
    expect(deriveRecoveryEvents({ reports: [report()], ...NO_ACTIVITY }, "2026-11-05").some((event) => event.kind === "week")).toBe(false);
  });

  it("stops the progressions when a newer intake took over, and at the end of the plan", () => {
    const newer = report({ id: "report-2", createdAt: new Date("2026-11-16T08:00:00Z"), plan: null, planCreatedAt: null });
    const taken = deriveRecoveryEvents({ reports: [report(), newer], ...NO_ACTIVITY }, "2026-12-20");
    expect(keys(taken.filter((event) => event.kind === "week"))).toEqual(["week:report-1:2", "week:report-1:3"]);

    const ended = deriveRecoveryEvents({ reports: [report()], ...NO_ACTIVITY }, "2027-03-01");
    expect(Math.max(...ended.filter((event) => event.key.startsWith("week:")).map((event) => Number(event.key.split(":")[2])))).toBe(9); // 60 days
  });

  it("logs missed days from the plan's skipped days", () => {
    const events = deriveRecoveryEvents({ reports: [report({ plan: plan({ skippedDays: ["2026-11-03", "2026-11-04"] }) })], ...NO_ACTIVITY }, "2026-11-05");
    expect(events.filter((event) => event.kind === "missed_day")).toHaveLength(2);
    expect(events.find((event) => event.key === "missed:report-1:2026-11-03")).toMatchObject({
      title: "Missed day: the plan moved forward",
      dateKey: "2026-11-03",
    });
  });

  it("logs completed sessions, post-session feedback and the plan changes that followed", () => {
    const events = deriveRecoveryEvents(
      {
        reports: [report()],
        progress: [
          {
            reportId: "report-1",
            dateKey: "2026-11-02",
            completedExercises: ["Glute Bridge", "Ankle Pumps"],
            completedAt: new Date("2026-11-02T10:00:00Z"),
            feedback: "relief",
            notes: null,
            discomfortExercises: [],
            discomfortDetails: null,
            rescheduledAt: null,
            updatedAt: new Date("2026-11-02T10:00:00Z"),
          },
          {
            reportId: "report-1",
            dateKey: "2026-11-03",
            completedExercises: [],
            completedAt: new Date("2026-11-03T10:00:00Z"),
            feedback: "issue",
            notes: "Hard to get up",
            discomfortExercises: ["Glute Bridge"],
            discomfortDetails: "Pulling in my lower back on the way up.",
            rescheduledAt: new Date("2026-11-03T10:02:00Z"),
            updatedAt: new Date("2026-11-03T10:02:00Z"),
          },
          // a day with exercises ticked but no feedback yet is not a finished session
          { reportId: "report-1", dateKey: "2026-11-04", completedExercises: ["Ankle Pumps"], completedAt: null, feedback: null, notes: null, discomfortExercises: [], discomfortDetails: null, rescheduledAt: null, updatedAt: new Date("2026-11-04T09:00:00Z") },
        ],
        painEvents: [],
      },
      "2026-11-04",
    );

    expect(events.filter((event) => event.kind === "session")).toHaveLength(2);
    expect(events.find((event) => event.key === "session:report-1:2026-11-02")?.detail).toBe("2 exercises done: Glute Bridge and Ankle Pumps.");
    expect(events.find((event) => event.key === "feedback:report-1:2026-11-02")).toMatchObject({
      title: "Feeling better after the session",
      meta: { feedback: "relief" },
    });
    const issue = events.find((event) => event.key === "feedback:report-1:2026-11-03")!;
    expect(issue.title).toBe("More discomfort after the session");
    expect(issue.detail).toBe("Discomfort with Glute Bridge. Pulling in my lower back on the way up. Note: Hard to get up");
    expect(events.find((event) => event.kind === "plan_adjusted")).toMatchObject({ title: "Plan adjusted after more discomfort", dateKey: "2026-11-03" });
  });

  it("logs Pain Override stops with the type, region and exercise", () => {
    const events = deriveRecoveryEvents(
      {
        reports: [report()],
        progress: [],
        painEvents: [
          {
            id: "pain-1",
            reportId: "report-1",
            dateKey: "2026-11-03",
            painType: "sharp_pain",
            regions: ["lumbar"],
            exerciseNames: ["Glute Bridge"],
            details: "It caught as I lifted.",
            createdAt: new Date("2026-11-03T11:00:00Z"),
            rescheduledAt: null,
          },
        ],
      },
      "2026-11-04",
    );
    const pain = events.find((event) => event.kind === "pain_override")!;
    expect(pain.key).toBe("pain:pain-1");
    expect(pain.title).toBe("Pain Override: the session was stopped");
    expect(pain.detail).toMatch(/in the lumbar during Glute Bridge\. It caught as I lifted\.$/);
    expect(pain.meta).toMatchObject({ regions: ["lumbar"] });
    expect(toneOf(pain)).toBe("alert");
  });

  it("includes a significant dynamic precaution change but not the plain week list", () => {
    const dynamic = (extra: Partial<DynamicPrecautions>): DynamicPrecautions => ({
      items: ["Avoid Glute Bridge until it has settled.", "Stop if the pain comes back."],
      badge: "Updated after Pain Override",
      kind: "pain_override",
      updatedAt: "2026-11-03T11:00:05.000Z",
      seenAt: null,
      weekNumber: 1,
      phaseIndex: 0,
      base: [],
      ...extra,
    });
    const changed = deriveRecoveryEvents({ reports: [report({ dynamic: dynamic({}) })], ...NO_ACTIVITY }, "2026-11-04").find((event) => event.kind === "precaution");
    expect(changed).toMatchObject({ key: "precaution:report-1:2026-11-03T11:00:05.000Z", title: "Precautions updated: after Pain Override" });
    expect(changed?.detail).toContain("Avoid Glute Bridge");

    for (const kind of ["initial", "week"] as const) {
      expect(deriveRecoveryEvents({ reports: [report({ dynamic: dynamic({ kind, badge: "Week 1 • Active" }) })], ...NO_ACTIVITY }, "2026-11-04").some((event) => event.kind === "precaution")).toBe(false);
    }
  });

  it("records the in-person care pause", () => {
    const events = deriveRecoveryEvents(
      { reports: [report({ plan: null, planCreatedAt: null, escalatedAt: new Date("2026-11-05T09:00:00Z"), escalationReason: "Leg weakness is getting worse." })], ...NO_ACTIVITY },
      "2026-11-06",
    );
    expect(events.find((event) => event.kind === "escalation")).toMatchObject({
      title: "Guided exercises paused: in-person care advised",
      detail: "Leg weakness is getting worse.",
    });
  });
});

describe("mergeRecoveryEvents", () => {
  it("lists events oldest first and shows a fact once, preferring the logged copy", () => {
    const derived = deriveRecoveryEvents({ reports: [report()], ...NO_ACTIVITY }, "2026-11-03");
    const logged = [
      analysisEvent({ ...report(), isFirst: true }),
      planEvent({ reportId: "report-1", createdAt: new Date("2026-11-01T08:10:00Z"), plan: plan(), rerun: true }),
      // a plan from before a re-run, which the current data no longer holds
      planEvent({ reportId: "report-1", createdAt: new Date("2026-10-30T08:10:00Z"), plan: plan(), rerun: false }),
    ];
    const merged = mergeRecoveryEvents(logged, derived);

    expect(new Set(keys(merged)).size).toBe(merged.length);
    expect(merged.filter((event) => event.kind === "plan")).toHaveLength(2);
    // the logged copy of the same fact wins
    expect(merged.find((event) => event.key === `plan:report-1:${new Date("2026-11-01T08:10:00Z").getTime()}`)?.title).toBe("Plan updated after re-running the analysis");
    const times = merged.map((event) => event.occurredAt);
    expect([...times].sort()).toEqual(times);
  });

  it("keeps a logged feedback entry after the day was reset and its row deleted", () => {
    const logged = [
      feedbackEvent({ reportId: "report-1", dateKey: "2026-11-02", feedback: "relief", discomfortExercises: [], discomfortDetails: null, notes: null, at: new Date("2026-11-02T10:00:00Z") }),
      adjustEvent({ reportId: "report-1", dateKey: "2026-11-02", cause: "feedback", at: new Date("2026-11-02T10:01:00Z") }),
    ];
    const merged = mergeRecoveryEvents(logged, deriveRecoveryEvents({ reports: [report()], ...NO_ACTIVITY }, "2026-11-03"));
    expect(merged.filter((event) => event.kind === "feedback")).toHaveLength(1);
    expect(merged.some((event) => event.kind === "plan_adjusted")).toBe(true);
  });
});

describe("order within a day", () => {
  it("puts a session before its feedback, and a missed day after what happened that day", () => {
    const events = mergeRecoveryEvents(
      [],
      deriveRecoveryEvents(
        {
          reports: [report({ plan: plan({ skippedDays: ["2026-11-01"] }) })],
          progress: [
            { reportId: "report-1", dateKey: "2026-11-02", completedExercises: ["Glute Bridge"], completedAt: new Date("2026-11-02T10:00:00Z"), feedback: "relief", notes: null, discomfortExercises: [], discomfortDetails: null, rescheduledAt: null, updatedAt: new Date("2026-11-02T10:00:00Z") },
          ],
          painEvents: [],
        },
        "2026-11-09",
      ),
    );
    const order = events.map((event) => event.key);
    expect(order.indexOf("session:report-1:2026-11-02")).toBeLessThan(order.indexOf("feedback:report-1:2026-11-02"));
    // the analysis and the plan on Nov 1 come first; the missed Nov 1 is noted at the end of that day
    expect(order.indexOf("missed:report-1:2026-11-01")).toBeGreaterThan(order.indexOf(`plan:report-1:${new Date("2026-11-01T08:10:00Z").getTime()}`));
    expect(order.indexOf("missed:report-1:2026-11-01")).toBeLessThan(order.indexOf("session:report-1:2026-11-02"));
    // a new week begins at the start of its day
    expect(events.find((event) => event.key === "week:report-1:2")?.occurredAt).toBe("2026-11-08T00:00:00.000Z");
  });
});
describe("summarizeTrends", () => {
  it("counts sessions, feedback, Pain Override stops by region, missed days and chat updates", () => {
    const events = deriveRecoveryEvents(
      {
        reports: [report({ plan: plan({ skippedDays: ["2026-11-03"] }) })],
        progress: [
          { reportId: "report-1", dateKey: "2026-11-02", completedExercises: ["Glute Bridge"], completedAt: new Date("2026-11-02T10:00:00Z"), feedback: "relief", notes: null, discomfortExercises: [], discomfortDetails: null, rescheduledAt: null, updatedAt: new Date("2026-11-02T10:00:00Z") },
          { reportId: "report-1", dateKey: "2026-11-04", completedExercises: [], completedAt: new Date("2026-11-04T10:00:00Z"), feedback: "issue", notes: null, discomfortExercises: ["Glute Bridge"], discomfortDetails: "Pulling.", rescheduledAt: new Date("2026-11-04T10:01:00Z"), updatedAt: new Date("2026-11-04T10:01:00Z") },
        ],
        painEvents: [
          { id: "p1", reportId: "report-1", dateKey: "2026-11-05", painType: "sharp_pain", regions: ["lumbar", "left_leg"], exerciseNames: ["Glute Bridge"], details: "Caught.", createdAt: new Date("2026-11-05T10:00:00Z"), rescheduledAt: null },
          { id: "p2", reportId: "report-1", dateKey: "2026-11-06", painType: "sharp_pain", regions: ["lumbar"], exerciseNames: ["Ankle Pumps"], details: "Again.", createdAt: new Date("2026-11-06T10:00:00Z"), rescheduledAt: null },
        ],
      },
      "2026-11-07",
    );
    const trends = summarizeTrends(events);
    expect(trends).toMatchObject({
      sessionsCompleted: 2,
      feedback: { relief: 1, same: 0, issue: 1 },
      painOverrides: 2,
      missedDays: 1,
      planAdjustments: 1,
    });
    expect(trends.painRegions).toEqual([
      { region: "lumbar", count: 2 },
      { region: "left leg", count: 1 },
    ]);
    expect(trends.feedbackSeries).toEqual([
      { dateKey: "2026-11-02", feedback: "relief" },
      { dateKey: "2026-11-04", feedback: "issue" },
    ]);
  });
});
