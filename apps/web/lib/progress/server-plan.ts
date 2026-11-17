import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { dateKeySchema, isDateKeyNearToday, type StoredTreatmentPlan } from "./dailyProgress";

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
  };
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
