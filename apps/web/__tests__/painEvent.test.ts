// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { id: "patient-1" } as { id: string } | null,
  report: null as null | Record<string, unknown>,
  painEvents: [] as Array<Record<string, unknown>>,
  progress: new Map<string, Record<string, unknown>>(),
  routineWrites: [] as unknown[],
  reschedule: vi.fn(),
}));

const plan = {
  durationMonths: 1,
  phases: [{ phase: "Phase 1", tagline: "Gentle" }],
  steps: [
    { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
    { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
    { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
  ],
  schedule: {
    horizonDays: 2,
    days: [
      { dayOffset: 0, status: "active", focus: "Today", tagline: "Go" },
      { dayOffset: 1, status: "upcoming", focus: "Tomorrow", tagline: "Go" },
    ],
  },
};

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => db.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/generatePlan", () => ({ rescheduleTreatmentPlan: db.reschedule }));
vi.mock("@/lib/db/prisma", () => {
  const key = (where: { clinicalReportId_dateKey: { clinicalReportId: string; dateKey: string } }) =>
    `${where.clinicalReportId_dateKey.clinicalReportId}:${where.clinicalReportId_dateKey.dateKey}`;
  const prisma = {
    clinicalReport: {
      findFirst: async ({ where }: { where: { id: string; patientId: string } }) =>
        db.report && db.report.id === where.id && db.report.patientId === where.patientId ? db.report : null,
      // Used by the progress-escalation check after each stop.
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.report && db.report.id === where.id
          ? {
              escalationKind: null,
              escalationReason: null,
              escalationEvidence: [],
              escalatedAt: null,
              ...db.report,
              dailyProgress: [...db.progress.values()],
              painEvents: db.painEvents.filter((event) => event.clinicalReportId === where.id),
            }
          : null,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(db.report ?? {}, data),
    },
    painEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `event-${db.painEvents.length + 1}`, rescheduledAt: null, ...data };
        db.painEvents.push(event);
        return event;
      },
      findFirst: async ({ where }: { where: { id: string; patientId: string } }) =>
        db.painEvents.find((event) => event.id === where.id && event.patientId === where.patientId) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const event = db.painEvents.find((item) => item.id === where.id);
        Object.assign(event ?? {}, data);
        return event;
      },
    },
    dailyProgress: {
      findUnique: async ({ where }: { where: Parameters<typeof key>[0] }) => db.progress.get(key(where)) ?? null,
      upsert: async ({ where, create, update }: { where: Parameters<typeof key>[0]; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = db.progress.get(key(where));
        const row = existing ? { ...existing, ...update } : { ...create };
        db.progress.set(key(where), row);
        return row;
      },
      updateMany: async () => ({ count: 1 }),
    },
    treatmentPlan: {
      update: async ({ data }: { data: { routine: unknown } }) => {
        db.routineWrites.push(data.routine);
        return {};
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  return { prisma };
});

import { reportPainEvent, reschedulePainEvent } from "@/actions/painEvent";
import { toggleExerciseCompletion } from "@/actions/dailyProgress";
import { toDateKey } from "@/lib/progress/dailyProgress";

const today = toDateKey(new Date());
const report = {
  exerciseNames: ["Glute Bridge"],
  painType: "sharp_pain" as const,
  regions: ["lumbar" as const],
  details: "Sharp pain in my lower back as I lifted.",
  context: { exerciseName: "Glute Bridge", rep: 2, set: 1, phase: "up", elapsedSeconds: 9.5 },
};

beforeEach(() => {
  db.user = { id: "patient-1" };
  db.report = {
    id: "report-1",
    patientId: "patient-1",
    primarySymptoms: "Low back pain",
    treatmentPlan: { id: "plan-1", routine: structuredClone(plan) },
  };
  db.painEvents.length = 0;
  db.progress.clear();
  db.routineWrites.length = 0;
  db.reschedule.mockReset();
});

describe("reportPainEvent", () => {
  it("saves the report and marks the day stopped, not completed", async () => {
    const result = await reportPainEvent("report-1", today, report);
    expect(result).toEqual({ success: true, eventId: "event-1", escalation: null });
    expect(db.painEvents[0]).toMatchObject({
      patientId: "patient-1",
      dateKey: today,
      exerciseNames: ["Glute Bridge"],
      painType: "sharp_pain",
      regions: ["lumbar"],
      details: report.details,
    });
    const day = db.progress.get(`report-1:${today}`);
    expect(day?.stoppedAt).toBeInstanceOf(Date);
    expect(day?.completedAt).toBeUndefined();
    expect(db.reschedule).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated users, other patients' plans and incomplete reports", async () => {
    db.user = null;
    expect((await reportPainEvent("report-1", today, report)).success).toBe(false);
    db.user = { id: "someone-else" };
    expect((await reportPainEvent("report-1", today, report)).success).toBe(false);
    db.user = { id: "patient-1" };
    expect((await reportPainEvent("report-1", today, { ...report, details: "   " })).success).toBe(false);
    expect((await reportPainEvent("report-1", today, { ...report, regions: [] })).success).toBe(false);
    expect((await reportPainEvent("report-1", today, { ...report, exerciseNames: ["Unknown"] })).success).toBe(false);
    expect((await reportPainEvent("report-1", "2001-01-01", report)).success).toBe(false);
    expect(db.painEvents).toHaveLength(0);
  });

  it("blocks checking off exercises on a stopped day", async () => {
    await reportPainEvent("report-1", today, report);
    const toggle = await toggleExerciseCompletion("report-1", today, "Ankle Pumps", true);
    expect(toggle.success).toBe(false);
  });
});

describe("reschedulePainEvent", () => {
  it("asks the AI with a red flag and removes flagged movements from later days", async () => {
    await reportPainEvent("report-1", today, report);
    db.reschedule.mockResolvedValue({
      success: true,
      schedule: {
        horizonDays: 2,
        days: [
          { dayOffset: 0, status: "active", focus: "Today", tagline: "Go", steps: [] },
          {
            dayOffset: 1,
            status: "upcoming",
            focus: "Gentle",
            tagline: "Easy",
            steps: [
              { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
            ],
          },
        ],
      },
    });

    const result = await reschedulePainEvent("report-1", "event-1");
    expect(result.success).toBe(true);
    expect(db.reschedule).toHaveBeenCalledTimes(1);
    expect(db.reschedule.mock.calls[0][2]).toMatchObject({ redFlag: true, regions: ["lumbar"], discomfortExercises: ["Glute Bridge"] });
    if (result.success) {
      const tomorrow = result.schedule.days.find((day) => day.dayOffset === 1);
      expect(tomorrow?.status).toBe("rest");
      expect(tomorrow?.steps ?? []).toHaveLength(0);
    }
    const saved = db.routineWrites[0] as { rescheduleBackups?: Record<string, unknown> };
    expect(saved.rescheduleBackups?.[today]).toBeDefined();
    expect(db.painEvents[0].rescheduledAt).toBeInstanceOf(Date);
  });

  it("keeps the saved report when the AI fails", async () => {
    await reportPainEvent("report-1", today, report);
    db.reschedule.mockResolvedValue({ success: false, error: "AI_PROVIDER_TIMEOUT" });
    const result = await reschedulePainEvent("report-1", "event-1");
    expect(result).toMatchObject({ success: false, aiError: "AI_PROVIDER_TIMEOUT" });
    expect(db.painEvents).toHaveLength(1);
    expect(db.routineWrites).toHaveLength(0);
  });

  it("cannot reschedule another patient's event", async () => {
    await reportPainEvent("report-1", today, report);
    db.user = { id: "someone-else" };
    expect((await reschedulePainEvent("report-1", "event-1")).success).toBe(false);
    expect(db.reschedule).not.toHaveBeenCalled();
  });
});

describe("progress escalation", () => {
  it("locks the case after Pain Override on two separate days", async () => {
    const yesterday = toDateKey(new Date(Date.now() - 86_400_000));

    const first = await reportPainEvent("report-1", yesterday, report);
    expect(first).toMatchObject({ success: true, escalation: null });

    const second = await reportPainEvent("report-1", today, report);
    expect(second).toMatchObject({ success: true, escalation: { kind: "progress" } });
    expect(db.report).toMatchObject({ escalationKind: "progress" });
    expect(db.report?.escalatedAt).toBeInstanceOf(Date);

    // Locked: no more progress actions until a new intake.
    const toggle = await toggleExerciseCompletion("report-1", today, "Ankle Pumps", true);
    expect(toggle).toMatchObject({ success: false, error: expect.stringMatching(/in-person/) });
  });
});
