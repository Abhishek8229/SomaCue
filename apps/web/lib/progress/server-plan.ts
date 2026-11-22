import { getCurrentUser } from "@/lib/auth/session";
import { checkScheduleDayAllowed } from "@/lib/billing/entitlements";
import { PLAN_WINDOW_ENDED_MESSAGE, planLengthDays, PRO_REQUIRED } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";
import { dateKeySchema, isDateKeyNearToday, type ActionFailure, type StoredTreatmentPlan } from "./dailyProgress";

/**
 * Server-only helpers shared by the progress and pain-event server actions.
 * This module has no "use server" directive, so nothing here is callable from
 * the browser. Import it only from server actions.
 */

export type OwnedPlan = {
  userId: string;
  primarySymptoms: string;
  treatmentPlanId: string;
  plan: StoredTreatmentPlan;
  /** Day 1 of the plan: the day the analysis was run. */
  startDateKey: string;
};

export function fail(error: string) {
  return { success: false, error } as const;
}

export async function loadOwnedPlan(reportId: string): Promise<OwnedPlan | { error: string }> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: "You must be signed in to save your progress." };
  }

  if (typeof reportId !== "string" || reportId.length === 0) {
    return { error: "The active treatment plan could not be found." };
  }

  const report = await prisma.clinicalReport.findFirst({
    where: { id: reportId, patientId: user.id },
    include: { treatmentPlan: true },
  });
  const routine = report?.treatmentPlan?.routine as StoredTreatmentPlan | null | undefined;
  if (!report || !report.treatmentPlan || !routine || !Array.isArray(routine.steps)) {
    return { error: "The active treatment plan could not be found." };
  }
  if (report.escalatedAt) {
    return { error: ESCALATED_MESSAGE };
  }

  return {
    userId: user.id,
    primarySymptoms: report.primarySymptoms,
    treatmentPlanId: report.treatmentPlan.id,
    plan: routine,
    // Plans saved before schedules were dated start on the day they were created.
    startDateKey: routine.startDateKey ?? report.treatmentPlan.createdAt.toISOString().slice(0, 10),
  };
}

/**
 * Plan Day limits: Days 1 to 7 on Free; on Pro the whole plan, for as long as the purchased
 * days last. Call after validateDateKey, from every action that records or changes a day.
 * (Pain Override is not one of them: stopping, reporting and the plan rebuild are safety care
 * and are free for every plan.)
 */
export async function checkPlanDay(owned: OwnedPlan, dateKey: string): Promise<ActionFailure | null> {
  const blocked = await checkScheduleDayAllowed(
    owned.userId,
    owned.startDateKey,
    dateKey,
    planLengthDays(owned.plan.durationMonths),
  );
  if (!blocked) return null;
  if ("feature" in blocked) return { success: false, error: PRO_REQUIRED, feature: blocked.feature };
  return { success: false, error: PLAN_WINDOW_ENDED_MESSAGE };
}

export function validateDateKey(dateKey: string) {
  if (!dateKeySchema.safeParse(dateKey).success || !isDateKeyNearToday(dateKey)) {
    return "That date is outside the days you can update.";
  }

  return null;
}

export const STOPPED_MESSAGE = "This session was stopped with Pain Override. Reset the day to continue.";

export const ESCALATED_MESSAGE =
  "This case needs an in-person medical evaluation, so guided exercises are paused.";
