// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: { id: "patient-1" } as { id: string } | null,
  /** the plan row the precautions live on */
  plan: null as null | { id: string; routine: Row; permanentPrecautions: unknown; dynamicPrecautions: unknown },
  progress: new Map<string, Row>(),
  painEvents: [] as Row[],
  dynamicWrites: 0,
  permanentWrites: 0,
  /** Recovery Timeline rows the actions logged */
  timeline: [] as Row[],
  failTimeline: false,
  failDynamicWrite: false,
  failSignals: false,
  reschedule: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => db.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/actions/generatePlan", () => ({ rescheduleTreatmentPlan: db.reschedule }));
vi.mock("@/lib/progress/schedule", () => ({ reconcileSchedule: db.reconcile }));
vi.mock("@/lib/kinematics/plan-repair", () => ({ repairSchedule: async (schedule: unknown) => schedule, stripFlaggedMovements: (schedule: unknown) => schedule }));
vi.mock("@/lib/db/prisma", () => {
  const key = (where: { clinicalReportId_dateKey: { clinicalReportId: string; dateKey: string } }) =>
    `${where.clinicalReportId_dateKey.clinicalReportId}:${where.clinicalReportId_dateKey.dateKey}`;
  const prisma = {
    clinicalReport: {
      findFirst: async ({ where }: { where: { id: string; patientId: string } }) =>
        db.plan && where.id === "report-1" && where.patientId === "patient-1"
          ? {
              id: "report-1",
              patientId: "patient-1",
              primarySymptoms: "Low back pain",
              escalatedAt: null,
              treatmentPlan: { id: db.plan.id, routine: db.plan.routine, createdAt: new Date() },
            }
          : null,
      // used by the progress-escalation check
      findUnique: async () => ({
        id: "report-1",
        escalationKind: null,
        escalationReason: null,
        escalationEvidence: [],
        escalatedAt: null,
        dailyProgress: [...db.progress.values()],
        painEvents: db.painEvents,
      }),
      update: async () => ({}),
    },
    painEvent: {
      create: async ({ data }: { data: Row }) => {
        const event = { id: `event-${db.painEvents.length + 1}`, createdAt: new Date(), rescheduledAt: null, ...data };
        db.painEvents.push(event);
        return event;
      },
      findMany: async ({ where, take }: { where: { dateKey: { gte: string } }; take: number }) =>
        (db.failSignals ? (() => { throw new Error("database unavailable"); })() : db.painEvents)
          .filter((event) => String(event.dateKey) >= where.dateKey.gte)
          .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
          .slice(0, take),
    },
    dailyProgress: {
      findUnique: async ({ where }: { where: Parameters<typeof key>[0] }) => db.progress.get(key(where)) ?? null,
      upsert: async ({ where, create, update }: { where: Parameters<typeof key>[0]; create: Row; update: Row }) => {
        const existing = db.progress.get(key(where));
        const row = existing ? { ...existing, ...update } : { ...create };
        db.progress.set(key(where), row);
        return row;
      },
      update: async ({ where, data }: { where: Parameters<typeof key>[0]; data: Row }) => {
        const row = { ...(db.progress.get(key(where)) ?? {}), ...data };
        db.progress.set(key(where), row);
        return row;
      },
      findMany: async ({ where, take }: { where: { feedback?: unknown; dateKey?: { gte: string } }; take?: number }) => {
        let rows = [...db.progress.values()];
        if (where.feedback) rows = rows.filter((row) => row.feedback != null);
        if (where.dateKey) rows = rows.filter((row) => String(row.dateKey) >= (where.dateKey as { gte: string }).gte);
        rows.sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));
        return take ? rows.slice(0, take) : rows;
      },
      updateMany: async () => ({ count: 1 }),
    },
    recoveryEvent: {
      upsert: async ({ where, create }: { where: { patientId_dedupeKey: { dedupeKey: string } }; create: Row }) => {
        if (db.failTimeline) throw new Error("database unavailable");
        if (!db.timeline.some((row) => row.dedupeKey === where.patientId_dedupeKey.dedupeKey)) db.timeline.push(create);
        return create;
      },
    },
    subscription: { findUnique: async () => ({ status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null }) },
    treatmentPlan: {
      findUnique: async () =>
        db.plan ? { permanentPrecautions: db.plan.permanentPrecautions, dynamicPrecautions: db.plan.dynamicPrecautions } : null,
      update: async ({ data }: { data: Row }) => {
        if (!db.plan) return {};
        if ("dynamicPrecautions" in data) {
          if (db.failDynamicWrite) throw new Error("database unavailable");
          if ("permanentPrecautions" in data) db.permanentWrites += 1;
          if ("permanentPrecautions" in data) db.plan.permanentPrecautions = JSON.parse(JSON.stringify(data.permanentPrecautions));
          db.dynamicWrites += 1;
          db.plan.dynamicPrecautions = JSON.parse(JSON.stringify(data.dynamicPrecautions));
        }
        if ("routine" in data) db.plan.routine = data.routine as Row;
        return {};
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  };
  return { prisma };
});

import { markPrecautionsSeen } from "@/actions/precautions";
import { reportPainEvent } from "@/actions/painEvent";
import { submitDailyFeedback, syncSchedule } from "@/actions/dailyProgress";
import { initialPrecautions, isUnread, legacyPermanentPrecautions, parseDynamicPrecautions, SAFE_DEFAULTS } from "@/lib/precautions/precautions";
import { legacyPrecautions } from "@/lib/precautions/server";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import { toDateKey } from "@/lib/progress/dailyProgress";

const keyDaysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateKey(date);
};
const today = toDateKey(new Date());

const AI_PERMANENT = ["Avoid loaded forward bending.", "Keep a neutral spine when lifting.", "Stop and seek care for leg numbness."];
const AI_WEEK_ONE = ["Use small ranges in week 1.", "Pause if the pain spreads down the leg."];
const STEPS = [
  { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
  { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
  { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
];

function routine(startDaysAgo: number): Row {
  return {
    durationMonths: 2,
    phases: [
      { phase: "Calm", tagline: "Settle the irritated tissue" },
      { phase: "Build", tagline: "Add strength and range" },
    ],
    steps: STEPS,
    startDateKey: keyDaysAgo(startDaysAgo),
    schedule: { horizonDays: 1, days: [{ dayOffset: 0, status: "active", focus: "Today", tagline: "Go" }] },
  };
}

function setPlan(startDaysAgo: number, withPrecautions = true) {
  const start = initialPrecautions({ permanentPrecautions: AI_PERMANENT, dynamicPrecautions: AI_WEEK_ONE }, new Date(Date.now() - startDaysAgo * 86_400_000));
  db.plan = {
    id: "plan-1",
    routine: routine(startDaysAgo),
    permanentPrecautions: withPrecautions ? start.permanent : null,
    dynamicPrecautions: withPrecautions ? start.dynamic : null,
  };
}

const stored = () => parseDynamicPrecautions(db.plan?.dynamicPrecautions);

beforeEach(() => {
  db.user = { id: "patient-1" };
  db.progress.clear();
  db.painEvents.length = 0;
  db.dynamicWrites = 0;
  db.permanentWrites = 0;
  db.timeline.length = 0;
  db.failTimeline = false;
  db.failDynamicWrite = false;
  db.failSignals = false;
  db.reschedule.mockReset();
  db.reschedule.mockResolvedValue({ success: false, error: "AI_PROVIDER_FAILED" });
  db.reconcile.mockReset();
  db.reconcile.mockImplementation((plan: Row) => ({ plan, changed: false, skippedDateKeys: [], shiftedDays: 0 }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  setPlan(2); // today is Day 3
});

describe("dynamic precautions after post-session feedback", () => {
  it("updates after 'more discomfort': names the exercise, is unread, and costs no AI call of its own", async () => {
    const result = await submitDailyFeedback("report-1", today, {
      feedback: "issue",
      discomfortExercises: ["Glute Bridge"],
      discomfortDetails: "A pulling pain in my lower back on the way up.",
      notes: "",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const dynamic = result.dynamicPrecautions;
    expect(dynamic).toMatchObject({ kind: "feedback", badge: "Updated after feedback", weekNumber: 1, phaseIndex: 0, seenAt: null });
    expect(dynamic?.items[0]).toBe("More discomfort with Glute Bridge: use a smaller range, go slower, and stop if it returns.");
    expect(isUnread(dynamic!)).toBe(true);
    // saved on the plan row
    expect(stored()).toEqual(dynamic);
    expect(db.dynamicWrites).toBe(1);
    // the AI is called once, to rebuild the schedule, and never for the precautions
    expect(db.reschedule).toHaveBeenCalledTimes(1);
  });

  it("updates even when the AI schedule rebuild fails: the precautions are rules, not an AI call", async () => {
    db.reschedule.mockResolvedValue({ success: false, error: "AI_PROVIDER_TIMEOUT" });
    const result = await submitDailyFeedback("report-1", today, {
      feedback: "issue",
      discomfortExercises: ["Ankle Pumps"],
      discomfortDetails: "It aches more than yesterday.",
      notes: "",
    });
    expect(result).toMatchObject({ success: true, rescheduled: false, rescheduleError: "AI_PROVIDER_TIMEOUT" });
    expect(stored()?.items[0]).toMatch(/More discomfort with Ankle Pumps/);
  });

  it("updates after 'more relief' with no AI call at all", async () => {
    const result = await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" });
    expect(db.reschedule).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, rescheduled: false });
    expect(stored()).toMatchObject({ kind: "feedback", badge: "Updated after feedback", seenAt: null });
    expect(stored()?.items[0]).toMatch(/feeling better/);
  });

  it("updates after 'about the same'", async () => {
    await submitDailyFeedback("report-1", today, { feedback: "same", notes: "" });
    expect(stored()?.items[0]).toBe("Little change so far: keep today's range and add no extra reps or speed.");
  });

  it("keeps the AI's week-1 bullets in the list after a rule-based update", async () => {
    await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" });
    const items = stored()!.items;
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items).toEqual(expect.arrayContaining(AI_WEEK_ONE));
  });

  it("does not touch the permanent precautions", async () => {
    await submitDailyFeedback("report-1", today, { feedback: "issue", discomfortExercises: ["Glute Bridge"], discomfortDetails: "Hurts.", notes: "" });
    expect(db.plan?.permanentPrecautions).toEqual(AI_PERMANENT);
  });

  it("never fails the feedback if the precautions cannot be saved", async () => {
    db.failDynamicWrite = true;
    const result = await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" });
    expect(result).toMatchObject({ success: true, rescheduled: false, dynamicPrecautions: null });
    expect(db.progress.get(`report-1:${today}`)).toMatchObject({ feedback: "relief" });
  });
});

describe("dynamic precautions after Pain Override", () => {
  const report = {
    exerciseNames: ["Glute Bridge"],
    painType: "sharp_pain" as const,
    regions: ["lumbar" as const],
    details: "Sharp pain in my lower back as I lifted.",
    context: { exerciseName: "Glute Bridge", rep: 2, set: 1, phase: "up", elapsedSeconds: 9.5 },
  };

  it("updates straight after the report: what to avoid, where, and when to stop, with no AI call", async () => {
    const result = await reportPainEvent("report-1", today, report);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.dynamicPrecautions).toMatchObject({ kind: "pain_override", badge: "Updated after Pain Override", seenAt: null });
    expect(result.dynamicPrecautions?.items[0]).toBe(`Pain Override on ${today}: avoid Glute Bridge until it has settled, and keep clear of the lumbar.`);
    expect(result.dynamicPrecautions?.items[1]).toMatch(/If the pain in the lumbar comes back, stop straight away and rest/);
    expect(stored()).toEqual(result.dynamicPrecautions);
    expect(db.reschedule).not.toHaveBeenCalled();
  });

  it("keeps the Pain Override precautions, because a stopped day cannot take feedback", async () => {
    await reportPainEvent("report-1", today, report);
    await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" }).catch(() => undefined);
    // the day was stopped, so feedback is refused and the precautions from the report stand
    expect(stored()?.kind).toBe("pain_override");
  });

  it("never loses the Pain Override report if the precautions cannot be saved", async () => {
    db.failDynamicWrite = true;
    const result = await reportPainEvent("report-1", today, report);
    expect(result).toMatchObject({ success: true, dynamicPrecautions: null });
    expect(db.painEvents).toHaveLength(1);
    expect(db.progress.get(`report-1:${today}`)?.stoppedAt).toBeInstanceOf(Date);
  });
});

describe("dynamic precautions as the plan advances", () => {
  it("moves to week 2 on Day 8, with the phase in the text", async () => {
    setPlan(7); // today is Day 8
    const result = await syncSchedule("report-1", today, keyDaysAgo(7));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.dynamicPrecautions).toMatchObject({ kind: "week", badge: "Week 2 • Active", weekNumber: 2, phaseIndex: 0, seenAt: null });
    expect(result.dynamicPrecautions?.items[0]).toBe("Calm (week 2): Settle the irritated tissue. Move on only when the last session felt comfortable.");
    expect(stored()).toEqual(result.dynamicPrecautions);
  });

  it("moves to the next phase after 30 days", async () => {
    setPlan(30); // today is Day 31
    const result = await syncSchedule("report-1", today, keyDaysAgo(30));
    expect(result.success && result.dynamicPrecautions).toMatchObject({ weekNumber: 5, phaseIndex: 1, badge: "Week 5 • Active" });
    expect(stored()?.items[0]).toMatch(/^Build \(week 5\): Add strength and range/);
  });

  it("writes nothing while the week has not changed", async () => {
    const before = db.plan?.dynamicPrecautions;
    const result = await syncSchedule("report-1", today, keyDaysAgo(2));
    expect(result.success && result.dynamicPrecautions).toMatchObject({ kind: "initial", badge: "Week 1 • Active" });
    expect(db.dynamicWrites).toBe(0);
    expect(db.plan?.dynamicPrecautions).toEqual(before);
  });

  it("updates after a missed day, saying so", async () => {
    const skipped = keyDaysAgo(1);
    db.reconcile.mockImplementation((plan: Row) => ({
      plan: { ...plan, skippedDays: [skipped] },
      changed: true,
      skippedDateKeys: [skipped],
      shiftedDays: 1,
    }));
    const result = await syncSchedule("report-1", today, keyDaysAgo(2));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.dynamicPrecautions).toMatchObject({ kind: "missed_day", badge: "Updated after a missed day", seenAt: null });
    expect(result.dynamicPrecautions?.items).toContain("You missed 1 day: restart at the planned pace, not harder, to catch up.");
    expect(db.dynamicWrites).toBe(1);
  });

  it("never fails the schedule sync if the precautions cannot be saved", async () => {
    setPlan(7);
    db.failDynamicWrite = true;
    const result = await syncSchedule("report-1", today, keyDaysAgo(7));
    expect(result).toMatchObject({ success: true, dynamicPrecautions: null });
  });
});

describe("the update dot", () => {
  it("clears when the Dynamic tab is opened, and comes back with the next change", async () => {
    await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" });
    expect(isUnread(stored()!)).toBe(true);

    const seen = await markPrecautionsSeen("report-1");
    expect(seen).toMatchObject({ success: true });
    expect(isUnread(stored()!)).toBe(false);

    // a later change (here a new week) is unread again
    setPlan(7);
    db.plan!.dynamicPrecautions = { ...(db.plan!.dynamicPrecautions as Row), seenAt: new Date().toISOString() };
    await syncSchedule("report-1", today, keyDaysAgo(7));
    expect(isUnread(stored()!)).toBe(true);
  });

  it("refuses someone else's plan", async () => {
    db.user = { id: "someone-else" };
    expect(await markPrecautionsSeen("report-1")).toMatchObject({ success: false });
  });
});

describe("plans saved before precautions existed (null columns)", () => {
  const legacyPlan = (startDaysAgo: number) => {
    setPlan(startDaysAgo, false);
    expect(db.plan?.permanentPrecautions).toBeNull();
    expect(db.plan?.dynamicPrecautions).toBeNull();
  };
  const input = (startDaysAgo: number) => ({
    reportId: "report-1",
    plan: routine(startDaysAgo) as unknown as StoredTreatmentPlan,
    startDateKey: keyDaysAgo(startDaysAgo),
    todayKey: today,
  });

  it("builds a fallback for the page from the safe defaults and the current week, and writes nothing", async () => {
    legacyPlan(9); // today is Day 10, week 2
    const shown = await legacyPrecautions(input(9));

    expect(shown.permanent).toEqual([...SAFE_DEFAULTS]);
    expect(shown.permanent).toEqual(legacyPermanentPrecautions());
    expect(shown.dynamic).toMatchObject({ kind: "week", badge: "Week 2 • Active", weekNumber: 2, phaseIndex: 0 });
    expect(shown.dynamic.items.length).toBeGreaterThanOrEqual(3);
    expect(shown.dynamic.items.length).toBeLessThanOrEqual(5);
    expect(shown.dynamic.items[0]).toBe("Calm (week 2): Settle the irritated tissue. Move on only when the last session felt comfortable.");
    // unread until the Dynamic tab is opened; the page itself saves nothing and calls no AI
    expect(isUnread(shown.dynamic)).toBe(true);
    expect(db.dynamicWrites).toBe(0);
    expect(db.permanentWrites).toBe(0);
    expect(db.plan?.permanentPrecautions).toBeNull();
    expect(db.reschedule).not.toHaveBeenCalled();
  });

  it("uses recent feedback and Pain Override reports in the fallback", async () => {
    legacyPlan(2);
    db.progress.set(`report-1:${today}`, { clinicalReportId: "report-1", dateKey: today, feedback: "issue", discomfortExercises: ["Ankle Pumps"] });
    db.painEvents.push({
      id: "event-1",
      createdAt: new Date(),
      dateKey: today,
      exerciseNames: ["Glute Bridge"],
      regions: ["lumbar"],
      painType: "sharp_pain",
    });
    const shown = await legacyPrecautions(input(2));
    expect(shown.dynamic.items[0]).toBe(`Pain Override on ${today}: avoid Glute Bridge until it has settled, and keep clear of the lumbar.`);
    expect(shown.dynamic.items.join(" ")).toContain("More discomfort with Ankle Pumps");
    expect(shown.dynamic.items.length).toBeLessThanOrEqual(5);
  });

  it("keeps what is already saved and builds only what is missing", async () => {
    legacyPlan(2);
    const start = initialPrecautions({ permanentPrecautions: AI_PERMANENT, dynamicPrecautions: AI_WEEK_ONE });
    const onlyPermanent = await legacyPrecautions(input(2), { permanent: start.permanent, dynamic: null });
    expect(onlyPermanent.permanent).toEqual(AI_PERMANENT);
    expect(onlyPermanent.dynamic.kind).toBe("week");
    const onlyDynamic = await legacyPrecautions(input(2), { permanent: null, dynamic: start.dynamic });
    expect(onlyDynamic.permanent).toEqual([...SAFE_DEFAULTS]);
    expect(onlyDynamic.dynamic).toEqual(start.dynamic);
  });

  it("still gives a fallback if recent activity cannot be read", async () => {
    legacyPlan(2);
    db.failSignals = true;
    const shown = await legacyPrecautions(input(2));
    expect(shown.permanent).toEqual([...SAFE_DEFAULTS]);
    expect(shown.dynamic.items.length).toBeGreaterThanOrEqual(3);
  });

  it("saves both lists when the schedule syncs, with no AI call", async () => {
    legacyPlan(2);
    const result = await syncSchedule("report-1", today, keyDaysAgo(2));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.dynamicPrecautions).toMatchObject({ kind: "week", badge: "Week 1 • Active", weekNumber: 1 });
    expect(db.plan?.permanentPrecautions).toEqual([...SAFE_DEFAULTS]);
    expect(stored()).toEqual(result.dynamicPrecautions);
    expect(db.permanentWrites).toBe(1);
    expect(db.reschedule).not.toHaveBeenCalled();
  });

  it("syncs a missed day into a legacy plan and says so", async () => {
    legacyPlan(2);
    const skipped = keyDaysAgo(1);
    db.reconcile.mockImplementation((plan: Row) => ({ plan: { ...plan, skippedDays: [skipped] }, changed: true, skippedDateKeys: [skipped], shiftedDays: 1 }));
    const result = await syncSchedule("report-1", today, keyDaysAgo(2));
    expect(result.success && result.dynamicPrecautions).toMatchObject({ kind: "missed_day", badge: "Updated after a missed day" });
    expect(db.plan?.permanentPrecautions).toEqual([...SAFE_DEFAULTS]);
  });

  it("saves both lists after post-session feedback", async () => {
    legacyPlan(2);
    const result = await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" });
    expect(result).toMatchObject({ success: true });
    expect(stored()).toMatchObject({ kind: "feedback", badge: "Updated after feedback" });
    expect(db.plan?.permanentPrecautions).toEqual([...SAFE_DEFAULTS]);
    expect(db.permanentWrites).toBe(1);
  });

  it("saves both lists after a Pain Override report", async () => {
    legacyPlan(2);
    const result = await reportPainEvent("report-1", today, {
      exerciseNames: ["Glute Bridge"],
      painType: "sharp_pain",
      regions: ["lumbar"],
      details: "Sharp pain in my lower back as I lifted.",
      context: { exerciseName: "Glute Bridge", rep: 2, set: 1, phase: "up", elapsedSeconds: 9.5 },
    });
    expect(result.success && result.dynamicPrecautions).toMatchObject({ kind: "pain_override" });
    expect(stored()?.kind).toBe("pain_override");
    expect(db.plan?.permanentPrecautions).toEqual([...SAFE_DEFAULTS]);
  });

  it("saves both lists, already read, when the Dynamic tab is opened", async () => {
    legacyPlan(9);
    const seen = await markPrecautionsSeen("report-1", today);
    expect(seen).toMatchObject({ success: true });
    expect(db.plan?.permanentPrecautions).toEqual([...SAFE_DEFAULTS]);
    expect(stored()).toMatchObject({ kind: "week", weekNumber: 2 });
    expect(isUnread(stored()!)).toBe(false);
    // a second open changes nothing structural
    await markPrecautionsSeen("report-1", today);
    expect(db.permanentWrites).toBe(1);
  });

  it("never overwrites permanent precautions that already exist", async () => {
    setPlan(2);
    db.plan!.dynamicPrecautions = null; // permanent saved, dynamic missing
    await markPrecautionsSeen("report-1", today);
    expect(db.plan?.permanentPrecautions).toEqual(AI_PERMANENT);
    expect(stored()).not.toBeNull();
  });

  it("never fails a schedule sync or a Pain Override if the first save fails", async () => {
    legacyPlan(2);
    db.failDynamicWrite = true;
    expect(await syncSchedule("report-1", today, keyDaysAgo(2))).toMatchObject({ success: true, dynamicPrecautions: null });
    expect(db.plan?.permanentPrecautions).toBeNull();
  });
});

describe("Recovery Timeline entries logged as things happen", () => {
  const kinds = () => db.timeline.map((row) => row.kind);
  const byKind = (kind: string) => db.timeline.filter((row) => row.kind === kind);

  it("logs the finished session and its feedback, and the precaution change that followed", async () => {
    await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "Felt easier." });
    expect(kinds()).toEqual(expect.arrayContaining(["session", "feedback", "precaution"]));
    expect(byKind("feedback")[0]).toMatchObject({
      patientId: "patient-1",
      clinicalReportId: "report-1",
      title: "Feeling better after the session",
      dateKey: today,
      dedupeKey: `feedback:report-1:${today}`,
      meta: { feedback: "relief" },
    });
    expect(byKind("session")[0]).toMatchObject({ dedupeKey: `session:report-1:${today}`, title: "Session completed" });
    expect(String(byKind("precaution")[0].title)).toBe("Precautions updated: after feedback");
  });

  it("logs 'more discomfort' with the exercise and the patient's description", async () => {
    await submitDailyFeedback("report-1", today, {
      feedback: "issue",
      discomfortExercises: ["Glute Bridge"],
      discomfortDetails: "A pulling pain in my lower back on the way up.",
      notes: "",
    });
    expect(byKind("feedback")[0]).toMatchObject({ title: "More discomfort after the session", meta: { feedback: "issue" } });
    expect(String(byKind("feedback")[0].detail)).toBe("Discomfort with Glute Bridge. A pulling pain in my lower back on the way up.");
  });

  it("logs a Pain Override trigger and the precautions it changed", async () => {
    await reportPainEvent("report-1", today, {
      exerciseNames: ["Glute Bridge"],
      painType: "sharp_pain",
      regions: ["lumbar"],
      details: "Sharp pain in my lower back as I lifted.",
      context: { exerciseName: "Glute Bridge", rep: 2, set: 1, phase: "up", elapsedSeconds: 9.5 },
    });
    expect(byKind("pain_override")[0]).toMatchObject({
      title: "Pain Override: the session was stopped",
      meta: { regions: ["lumbar"], painType: "sharp_pain" },
    });
    expect(String(byKind("pain_override")[0].dedupeKey)).toMatch(/^pain:event-/);
    expect(String(byKind("precaution")[0].title)).toBe("Precautions updated: after Pain Override");
  });

  it("logs a missed day and a week progression from the schedule sync, once each", async () => {
    setPlan(7); // today is Day 8
    const skipped = keyDaysAgo(1);
    db.reconcile.mockImplementation((plan: Row) => ({ plan: { ...plan, skippedDays: [skipped] }, changed: true, skippedDateKeys: [skipped], shiftedDays: 1 }));
    await syncSchedule("report-1", today, keyDaysAgo(7));

    expect(byKind("missed_day")).toHaveLength(1);
    expect(byKind("missed_day")[0]).toMatchObject({ dedupeKey: `missed:report-1:${skipped}`, dateKey: skipped });

    // a second sync of the same facts adds nothing
    await syncSchedule("report-1", today, keyDaysAgo(7));
    expect(byKind("missed_day")).toHaveLength(1);
  });

  it("logs the new week when the plan moves into it", async () => {
    setPlan(7);
    await syncSchedule("report-1", today, keyDaysAgo(7));
    expect(byKind("week")[0]).toMatchObject({ dedupeKey: "week:report-1:2", title: "Week 2 began: Calm phase" });
  });

  it("never fails feedback, Pain Override or the sync when the timeline cannot be written", async () => {
    db.failTimeline = true;
    expect(await submitDailyFeedback("report-1", today, { feedback: "relief", notes: "" })).toMatchObject({ success: true });
    expect(db.progress.get(`report-1:${today}`)).toMatchObject({ feedback: "relief" });
    setPlan(7);
    expect(await syncSchedule("report-1", today, keyDaysAgo(7))).toMatchObject({ success: true });
    expect(db.timeline).toHaveLength(0);
  });
});