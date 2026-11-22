// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { id: "patient-1" } as { id: string } | null,
  report: null as null | Record<string, unknown>,
  painEvents: [] as Array<Record<string, unknown>>,
  progress: new Map<string, Record<string, unknown>>(),
  routineWrites: [] as unknown[],
  reschedule: vi.fn(),
  subscription: { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null } as {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
  } | null,
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
    // The billing checks read the plan. An active subscription keeps these tests about pain events.
    subscription: {
      findUnique: async () => db.subscription,
    },
    treatmentPlan: {
      // A plan made before precautions existed has none: the Pain Override report must work the same.
      findUnique: async () => ({ permanentPrecautions: null, dynamicPrecautions: null }),
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
import { resetDailyProgress, submitDailyFeedback, toggleExerciseCompletion } from "@/actions/dailyProgress";
import { toDateKey } from "@/lib/progress/dailyProgress";
import { loadedRegions, stripFlaggedMovements } from "@/lib/kinematics/plan-repair";
import { findReferenceExercise } from "@/lib/kinematics/reference-exercises";
import type { Region } from "@/lib/kinematics/vocabulary";

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
    treatmentPlan: { id: "plan-1", routine: structuredClone(plan), createdAt: new Date() },
  };
  db.painEvents.length = 0;
  db.progress.clear();
  db.routineWrites.length = 0;
  db.reschedule.mockReset();
  db.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
});

describe("reportPainEvent", () => {
  it("saves the report and marks the day stopped, not completed", async () => {
    const result = await reportPainEvent("report-1", today, report);
    expect(result).toEqual({ success: true, eventId: "event-1", escalation: null, dynamicPrecautions: null });
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

/** The plan's Day 1, so that today is plan Day `day`. */
const startForDay = (day: number) => {
  const date = new Date();
  date.setDate(date.getDate() - (day - 1));
  return toDateKey(date);
};

describe("Pain Override is free on every plan", () => {
  beforeEach(() => {
    db.subscription = null;
  });

  it("always lets a Free user stop and report: that is safety, not a feature", async () => {
    const result = await reportPainEvent("report-1", today, report);
    expect(result).toMatchObject({ success: true, eventId: "event-1" });
    expect(db.painEvents).toHaveLength(1);
    expect(db.progress.get(`report-1:${today}`)?.stoppedAt).toBeInstanceOf(Date);
  });

  const rebuilt = {
    success: true,
    schedule: { horizonDays: 1, days: [{ dayOffset: 0, status: "active", focus: "Today", tagline: "Go", steps: [] }] },
  };

  it("rebuilds the plan around the report for a Free user, with no plan check", async () => {
    db.reschedule.mockResolvedValue(rebuilt);
    await reportPainEvent("report-1", today, report);
    const result = await reschedulePainEvent("report-1", "event-1");
    expect(result.success).toBe(true);
    expect(db.reschedule).toHaveBeenCalledTimes(1);
    expect(db.routineWrites).toHaveLength(1);
  });

  it("rebuilds the plan for a Pro user the same way", async () => {
    db.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
    db.reschedule.mockResolvedValue(rebuilt);
    await reportPainEvent("report-1", today, report);
    expect((await reschedulePainEvent("report-1", "event-1")).success).toBe(true);
    expect(db.reschedule).toHaveBeenCalledTimes(1);
  });

  it("never answers PRO_REQUIRED for Pain Override, even for a Free user whose Week 1 has ended", async () => {
    db.reschedule.mockResolvedValue(rebuilt);
    await reportPainEvent("report-1", today, report);
    const result = await reschedulePainEvent("report-1", "event-1");
    expect(JSON.stringify(result)).not.toContain("PRO_REQUIRED");
  });
});

describe("Plan days: Free covers Week 1 (Days 1 to 7), Pro the whole plan", () => {
  const withStart = (day: number) => {
    (db.report as { treatmentPlan: { routine: { startDateKey?: string } } }).treatmentPlan.routine.startDateKey = startForDay(day);
  };
  const withMonths = (months: number) => {
    (db.report as { treatmentPlan: { routine: { durationMonths: number } } }).treatmentPlan.routine.durationMonths = months;
  };
  const tick = () => toggleExerciseCompletion("report-1", today, "Ankle Pumps", true);

  it("lets a Free user record exercises up to Day 7", async () => {
    db.subscription = null;
    withStart(7);
    expect((await tick()).success).toBe(true);
  });

  it("asks a Free user to upgrade from Day 8, and saves nothing", async () => {
    db.subscription = null;
    withStart(8);
    expect(await tick()).toEqual({ success: false, error: "PRO_REQUIRED", feature: "schedule" });
    expect(db.progress.size).toBe(0);
  });

  it("applies the same limit to resetting a day and to feedback", async () => {
    db.subscription = null;
    withStart(9);
    expect(await resetDailyProgress("report-1", today)).toMatchObject({ success: false, error: "PRO_REQUIRED" });
    expect(await submitDailyFeedback("report-1", today, { feedback: "same" })).toMatchObject({ success: false, error: "PRO_REQUIRED" });
  });

  it("lets Pro continue past Day 7, up to the last day of a 1, 2 or 3 month plan", async () => {
    db.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
    for (const [months, lastDay] of [[1, 30], [2, 60], [3, 90]] as const) {
      withMonths(months);
      withStart(8);
      expect((await tick()).success, `${months}m Day 8`).toBe(true);
      withStart(lastDay);
      expect((await tick()).success, `${months}m Day ${lastDay}`).toBe(true);
    }
  });

  it("tells a Pro user past the last day of their plan it has finished, not to upgrade", async () => {
    db.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
    withMonths(1);
    withStart(31);
    const result = await tick();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).not.toBe("PRO_REQUIRED");
      expect(result.error).toMatch(/plan has finished/);
    }
  });

  it("sends a Pro user whose purchased days have ended back to asking for Pro past Day 7", async () => {
    db.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: new Date(Date.now() - 60_000) };
    withMonths(3);
    withStart(20);
    expect(await tick()).toEqual({ success: false, error: "PRO_REQUIRED", feature: "schedule" });
  });

  it("counts a plan saved before schedules were dated from the day it was created", async () => {
    db.subscription = null;
    const created = new Date();
    created.setDate(created.getDate() - 9);
    (db.report as { treatmentPlan: { createdAt: Date } }).treatmentPlan.createdAt = created;
    expect(await tick()).toMatchObject({ success: false, error: "PRO_REQUIRED" });
  });
});

describe("Pain Override veto on alternating exercises", () => {
  const stepFor = (name: string, alternateSides?: boolean) => {
    const spec = structuredClone(findReferenceExercise(name)!.spec);
    if (alternateSides !== undefined) spec.alternateSides = alternateSides;
    return { exerciseName: name, animationTriggerId: name.toLowerCase().replaceAll(" ", "_"), durationSeconds: 30, voiceCue: "Go", movement: spec };
  };
  const scheduleWith = (...steps: ReturnType<typeof stepFor>[]) => ({
    horizonDays: 2,
    days: [
      { dayOffset: 0, status: "active" as const, focus: "Today", tagline: "Go", steps: [] },
      { dayOffset: 1, status: "upcoming" as const, focus: "Next", tagline: "Go", steps },
    ],
  });
  const tomorrowSteps = (regions: Region[], ...steps: ReturnType<typeof stepFor>[]) =>
    stripFlaggedMovements(scheduleWith(...steps), { exerciseNames: [], regions }).days.find((day) => day.dayOffset === 1)?.steps ?? [];

  it("loads the mirrored side of every left or right region when the exercise alternates", () => {
    const alternating = stepFor("Seated Knee Extension");
    expect(alternating.movement.alternateSides).toBe(true);
    expect(alternating.movement.targetRegions).toEqual(["knee_left"]);
    expect(loadedRegions(alternating.movement)).toEqual(expect.arrayContaining(["knee_left", "knee_right"]));
  });

  it("vetoes an alternating exercise when the right side hurts, even though it is tagged left", () => {
    expect(tomorrowSteps(["knee_right"], stepFor("Seated Knee Extension"))).toHaveLength(0);
  });

  it("vetoes it when the left side hurts too", () => {
    expect(tomorrowSteps(["knee_left"], stepFor("Seated Knee Extension"))).toHaveLength(0);
  });

  it("mirrors a mixed-side exercise: Bird Dog loads both shoulders and both hips", () => {
    for (const region of ["shoulder_left", "shoulder_right", "hip_left", "hip_right"] as Region[]) {
      expect(tomorrowSteps([region], stepFor("Bird Dog"))).toHaveLength(0);
    }
  });

  it("does not mirror an exercise that does not alternate: one-sided stays one-sided", () => {
    const oneSided = stepFor("Seated Knee Extension", false);
    expect(loadedRegions(oneSided.movement)).not.toContain("knee_right");
    expect(tomorrowSteps(["knee_right"], oneSided)).toHaveLength(1);
    expect(tomorrowSteps(["knee_left"], oneSided)).toHaveLength(0);
  });

  it("keeps exercises that load neither side of the painful region", () => {
    expect(tomorrowSteps(["knee_right"], stepFor("Seated Chin Tuck"))).toHaveLength(1);
  });

  it("never touches today's session", () => {
    const schedule = scheduleWith(stepFor("Glute Bridge"));
    schedule.days[0].steps = [stepFor("Seated Knee Extension")] as never;
    const result = stripFlaggedMovements(schedule, { exerciseNames: [], regions: ["knee_right"] });
    expect(result.days[0].steps).toHaveLength(1);
  });
});