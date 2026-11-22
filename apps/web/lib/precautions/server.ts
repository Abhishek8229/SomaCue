import { prisma } from "@/lib/db/prisma";
import { planDayNumber } from "@/lib/billing/plans";
import { logRecoveryEvents } from "@/lib/recovery/server";
import { precautionEvent, weekEvent } from "@/lib/recovery/timeline";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import {
  createDynamicPrecautions,
  legacyPermanentPrecautions,
  parseDynamicPrecautions,
  parsePermanentPrecautions,
  phaseIndexOf,
  precautionsAreStale,
  weekOfPlan,
  type DynamicPrecautions,
  type PlanPrecautions,
  type PrecautionFeedback,
  type PrecautionPainEvent,
  type PrecautionUpdate,
} from "./precautions";

/*
 * Server-only. Rebuilds the dynamic precautions from what the app already saved (no AI call) and
 * stores them on the plan. It never throws: precautions are guidance, and a failure here must not
 * undo or block the feedback, the Pain Override report or the schedule change that triggered it.
 */

const DAY_MS = 86_400_000;
/** How far back feedback, Pain Override reports and missed days still shape the precautions. */
const LOOKBACK_DAYS = 7;

function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

export type RefreshInput = {
  treatmentPlanId: string;
  reportId: string;
  plan: StoredTreatmentPlan;
  /** Day 1 of the plan, YYYY-MM-DD */
  startDateKey: string;
  /** the user's local date, YYYY-MM-DD */
  todayKey: string;
  kind: Exclude<PrecautionUpdate, "initial">;
  /** The patient, so a saved change can be added to their Recovery Timeline. Optional: nothing is logged without it. */
  patientId?: string;
};

type Signals = { feedback: PrecautionFeedback[]; painEvents: PrecautionPainEvent[] };

/** The feedback and Pain Override reports of the last 7 days that shape the dynamic precautions. */
async function loadSignals(reportId: string, todayKey: string): Promise<Signals> {
  const since = shiftDateKey(todayKey, -(LOOKBACK_DAYS - 1));
  const [feedback, painEvents] = await Promise.all([
    prisma.dailyProgress.findMany({
      where: { clinicalReportId: reportId, feedback: { not: null }, dateKey: { gte: since } },
      orderBy: { dateKey: "desc" },
      take: 3,
      select: { dateKey: true, feedback: true, discomfortExercises: true },
    }),
    prisma.painEvent.findMany({
      where: { clinicalReportId: reportId, dateKey: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: { dateKey: true, exerciseNames: true, regions: true, painType: true },
    }),
  ]);
  return {
    feedback: feedback.flatMap((entry) =>
      entry.feedback === "relief" || entry.feedback === "same" || entry.feedback === "issue"
        ? [{ dateKey: entry.dateKey, feedback: entry.feedback, discomfortExercises: entry.discomfortExercises }]
        : [],
    ),
    painEvents,
  };
}

function buildDynamic(
  input: Pick<RefreshInput, "plan" | "startDateKey" | "todayKey">,
  kind: PrecautionUpdate,
  base: string[],
  signals: Signals,
): DynamicPrecautions {
  const dayNumber = Math.max(1, planDayNumber(input.startDateKey, input.todayKey));
  const weekNumber = weekOfPlan(dayNumber);
  const phases = input.plan.phases ?? [];
  const phaseIndex = phaseIndexOf(dayNumber, phases.length);
  const since = shiftDateKey(input.todayKey, -(LOOKBACK_DAYS - 1));
  return createDynamicPrecautions({
    kind,
    weekNumber,
    phaseIndex,
    phase: phases[phaseIndex] ?? null,
    base,
    feedback: signals.feedback,
    painEvents: signals.painEvents,
    missedDays: (input.plan.skippedDays ?? []).filter((dateKey) => dateKey >= since && dateKey <= input.todayKey).length,
  });
}

/**
 * The precautions for a plan saved before they existed (its columns are null), built from the plan,
 * the week it is in and the recent feedback and Pain Override reports. Nothing is saved and no AI is
 * called. The first save happens when the user interacts with the plan (see `refreshDynamicPrecautions`).
 * Shown as "Week N Active" and unread, until the Dynamic tab is opened. Never throws.
 */
export async function legacyPrecautions(
  input: Pick<RefreshInput, "reportId" | "plan" | "startDateKey" | "todayKey">,
  saved: { permanent?: string[] | null; dynamic?: DynamicPrecautions | null } = {},
): Promise<PlanPrecautions> {
  let signals: Signals = { feedback: [], painEvents: [] };
  if (!saved.dynamic) {
    try {
      signals = await loadSignals(input.reportId, input.todayKey);
    } catch (error) {
      console.error("[SomaCue precautions] Could not read recent activity for the precautions.", error instanceof Error ? error.message : error);
    }
  }
  return {
    permanent: saved.permanent ?? legacyPermanentPrecautions(),
    dynamic: saved.dynamic ?? buildDynamic(input, "week", [], signals),
  };
}

/**
 * Rebuilds and saves the dynamic precautions. Returns them, or null when anything failed. A plan saved
 * before precautions existed is given its permanent list (the safe defaults) in the same write, so it
 * has a full set from its first interaction on.
 */
export async function refreshDynamicPrecautions(input: RefreshInput): Promise<DynamicPrecautions | null> {
  try {
    const row = await prisma.treatmentPlan.findUnique({
      where: { id: input.treatmentPlanId },
      select: { permanentPrecautions: true, dynamicPrecautions: true },
    });
    if (!row) return null;
    const needsPermanent = !parsePermanentPrecautions(row.permanentPrecautions);
    const current = parseDynamicPrecautions(row.dynamicPrecautions);

    const signals = await loadSignals(input.reportId, input.todayKey);
    const next = buildDynamic(input, input.kind, current?.base ?? [], signals);

    await prisma.treatmentPlan.update({
      where: { id: input.treatmentPlanId },
      data: needsPermanent ? { permanentPrecautions: legacyPermanentPrecautions(), dynamicPrecautions: next } : { dynamicPrecautions: next },
    });
    // Week 1 is the start of the plan, which the timeline already shows.
    if (input.patientId && !(input.kind === "week" && next.weekNumber <= 1)) {
      const patientId = input.patientId;
      const phases = input.plan.phases ?? [];
      // A new week is already a timeline milestone; a rebuilt list after feedback, a Pain Override or a missed day is logged with its first lines.
      await logRecoveryEvents(patientId, () =>
        input.kind === "week"
          ? weekEvent({
              reportId: input.reportId,
              weekNumber: next.weekNumber,
              phase: phases[next.phaseIndex] ?? null,
              dateKey: input.todayKey,
              at: next.updatedAt,
            })
          : precautionEvent({ reportId: input.reportId, updatedAt: next.updatedAt, badge: next.badge, items: next.items }),
      );
    }
    return next;
  } catch (error) {
    console.error("[SomaCue precautions] Could not update the dynamic precautions.", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Saves the precautions of a plan that predates them (either column null), so what the page showed
 * is what is stored. Does nothing for a plan that has both. Returns the stored dynamic precautions, or null.
 */
export async function ensurePlanPrecautions(input: Omit<RefreshInput, "kind">): Promise<DynamicPrecautions | null> {
  try {
    const row = await prisma.treatmentPlan.findUnique({
      where: { id: input.treatmentPlanId },
      select: { permanentPrecautions: true, dynamicPrecautions: true },
    });
    if (!row) return null;
    const current = parseDynamicPrecautions(row.dynamicPrecautions);
    if (parsePermanentPrecautions(row.permanentPrecautions) && current) return current;
    return await refreshDynamicPrecautions({ ...input, kind: "week" });
  } catch (error) {
    console.error("[SomaCue precautions] Could not save the precautions for this plan.", error instanceof Error ? error.message : error);
    return null;
  }
}
/**
 * Called when the schedule is brought up to the calendar. A day that was missed rebuilds the precautions
 * ("Updated after a missed day"); so does moving into a new week or phase ("Week 2 • Active"). Otherwise
 * nothing is written and the stored precautions are returned as they are.
 */
export async function refreshForProgress(
  input: Omit<RefreshInput, "kind"> & { newlyMissedDays: number },
): Promise<DynamicPrecautions | null> {
  try {
    const row = await prisma.treatmentPlan.findUnique({
      where: { id: input.treatmentPlanId },
      select: { permanentPrecautions: true, dynamicPrecautions: true },
    });
    if (!row) return null;
    const current = parseDynamicPrecautions(row.dynamicPrecautions);

    // A plan that predates precautions is given them here, the first time its schedule is synced.
    if (!parsePermanentPrecautions(row.permanentPrecautions)) {
      return await refreshDynamicPrecautions({ ...input, kind: input.newlyMissedDays > 0 ? "missed_day" : "week" });
    }
    if (input.newlyMissedDays > 0) return await refreshDynamicPrecautions({ ...input, kind: "missed_day" });

    const dayNumber = Math.max(1, planDayNumber(input.startDateKey, input.todayKey));
    const stale = !current || precautionsAreStale(current, dayNumber, input.plan.phases?.length ?? 1);
    return stale ? await refreshDynamicPrecautions({ ...input, kind: "week" }) : current;
  } catch (error) {
    console.error("[SomaCue precautions] Could not check the precautions for this week.", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Marks the dynamic precautions as read, so the update dot goes away. */
export async function markDynamicPrecautionsSeen(treatmentPlanId: string, now: Date = new Date()): Promise<DynamicPrecautions | null> {
  const row = await prisma.treatmentPlan.findUnique({ where: { id: treatmentPlanId }, select: { dynamicPrecautions: true } });
  const current = parseDynamicPrecautions(row?.dynamicPrecautions);
  if (!current) return null;
  const seen = { ...current, seenAt: now.toISOString() };
  await prisma.treatmentPlan.update({ where: { id: treatmentPlanId }, data: { dynamicPrecautions: seen } });
  return seen;
}