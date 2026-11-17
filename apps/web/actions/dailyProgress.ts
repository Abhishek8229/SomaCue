"use server";

import { revalidatePath } from "next/cache";
import { rescheduleTreatmentPlan } from "./generatePlan";
import { prisma } from "@/lib/db/prisma";
import { checkProgressEscalation } from "@/lib/clinical/server-escalation";
import { repairSchedule } from "@/lib/kinematics/plan-repair";
import {
  applyScheduleRestore,
  collectExerciseNames,
  feedbackSubmissionSchema,
  findRescheduleProblem,
  mergeRescheduledSchedule,
  recordRescheduleBackup,
  restoreScheduleForReset,
  withoutBackups,
  type FeedbackSubmission,
  type ResetDayResult,
  type SubmitFeedbackResult,
  type ToggleExerciseResult,
} from "@/lib/progress/dailyProgress";
import {
  STOPPED_MESSAGE,
  fail,
  loadOwnedPlan,
  validateDateKey,
} from "@/lib/progress/server-plan";

export async function toggleExerciseCompletion(
  reportId: string,
  dateKey: string,
  exerciseName: string,
  checked: boolean,
): Promise<ToggleExerciseResult> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) {
    return fail(owned.error);
  }

  const dateError = validateDateKey(dateKey);
  if (dateError) {
    return fail(dateError);
  }

  if (typeof checked !== "boolean" || !collectExerciseNames(owned.plan).has(exerciseName)) {
    return fail("That exercise is not part of your plan.");
  }

  const where = { clinicalReportId_dateKey: { clinicalReportId: reportId, dateKey } };
  const existing = await prisma.dailyProgress.findUnique({ where });
  if (existing?.stoppedAt) {
    return fail(STOPPED_MESSAGE);
  }
  if (existing?.completedAt) {
    return fail("This day is already marked as done.");
  }

  const current = existing?.completedExercises ?? [];
  const completedExercises = checked
    ? [...new Set([...current, exerciseName])]
    : current.filter((name) => name !== exerciseName);

  const row = await prisma.dailyProgress.upsert({
    where,
    create: {
      clinicalReportId: reportId,
      patientId: owned.userId,
      dateKey,
      completedExercises,
    },
    update: { completedExercises },
  });

  return { success: true, completedExercises: row.completedExercises };
}

export async function resetDailyProgress(
  reportId: string,
  dateKey: string,
): Promise<ResetDayResult> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) {
    return fail(owned.error);
  }

  const dateError = validateDateKey(dateKey);
  if (dateError) {
    return fail(dateError);
  }

  // Deleting the row clears the completed flag, feedback, discomfort details
  // and checked exercises together. A day with no row is already reset.
  const where = { clinicalReportId: reportId, patientId: owned.userId, dateKey };
  const existing = await prisma.dailyProgress.findFirst({ where });
  const restore = restoreScheduleForReset(owned.plan, dateKey, existing?.rescheduledAt != null);

  if (!restore.changed) {
    await prisma.dailyProgress.deleteMany({ where });
    revalidatePath("/workspace");
    return { success: true };
  }

  // Undo the schedule change that this day's feedback caused, together with the delete.
  await prisma.$transaction([
    prisma.dailyProgress.deleteMany({ where }),
    prisma.treatmentPlan.update({
      where: { id: owned.treatmentPlanId },
      data: { routine: applyScheduleRestore(owned.plan, restore) },
    }),
  ]);

  revalidatePath("/workspace");
  return { success: true, schedule: restore.schedule };
}

export async function submitDailyFeedback(
  reportId: string,
  dateKey: string,
  submission: FeedbackSubmission,
): Promise<SubmitFeedbackResult> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) {
    return fail(owned.error);
  }

  const dateError = validateDateKey(dateKey);
  if (dateError) {
    return fail(dateError);
  }

  const parsed = feedbackSubmissionSchema.safeParse(submission);
  if (!parsed.success) {
    return fail("Please complete the feedback before submitting.");
  }

  const feedback = parsed.data;
  const knownExercises = collectExerciseNames(owned.plan);
  const discomfortExercises =
    feedback.feedback === "issue" ? [...new Set(feedback.discomfortExercises)] : [];
  if (discomfortExercises.some((name) => !knownExercises.has(name))) {
    return fail("Choose exercises from today's plan.");
  }

  const where = { clinicalReportId_dateKey: { clinicalReportId: reportId, dateKey } };
  const existing = await prisma.dailyProgress.findUnique({ where });
  if (existing?.stoppedAt) {
    return fail(STOPPED_MESSAGE);
  }
  const isRescheduleRetry =
    existing?.completedAt != null &&
    existing.feedback === "issue" &&
    existing.rescheduledAt === null &&
    feedback.feedback === "issue";
  if (existing?.completedAt && !isRescheduleRetry) {
    return fail("Feedback for this day was already submitted.");
  }

  // Feedback is saved before any AI call so it is never lost if the AI fails.
  const feedbackData = {
    completedAt: existing?.completedAt ?? new Date(),
    feedback: feedback.feedback,
    notes: feedback.notes ? feedback.notes : null,
    discomfortExercises,
    discomfortDetails: feedback.feedback === "issue" ? feedback.discomfortDetails : null,
  };
  await prisma.dailyProgress.upsert({
    where,
    create: {
      clinicalReportId: reportId,
      patientId: owned.userId,
      dateKey,
      completedExercises: [],
      ...feedbackData,
    },
    update: feedbackData,
  });

  // Repeated pain or no improvement locks the plan for in-person care; no reschedule then.
  const escalation = await checkProgressEscalation(reportId, dateKey);
  if (escalation) {
    revalidatePath("/workspace");
    return { success: true, rescheduled: false, escalation };
  }

  if (feedback.feedback !== "issue") {
    revalidatePath("/workspace");
    return { success: true, rescheduled: false };
  }

  const rescheduleResult = await rescheduleTreatmentPlan(
    owned.primarySymptoms,
    withoutBackups(owned.plan),
    {
    dateKey,
    discomfortExercises,
    discomfortDetails: feedback.discomfortDetails,
    notes: feedback.notes || undefined,
  });
  if (!rescheduleResult.success) {
    revalidatePath("/workspace");
    return { success: true, rescheduled: false, rescheduleError: rescheduleResult.error };
  }

  const problem = findRescheduleProblem(rescheduleResult.schedule, discomfortExercises);
  if (problem) {
    console.error("[SomaCue AI] Rescheduled plan rejected.", { problem });
    revalidatePath("/workspace");
    return { success: true, rescheduled: false, rescheduleError: "AI_PROVIDER_FAILED" };
  }

  const schedule = await repairSchedule(
    mergeRescheduledSchedule(owned.plan.schedule, rescheduleResult.schedule),
    owned.plan,
  );
  await prisma.$transaction([
    prisma.treatmentPlan.update({
      where: { id: owned.treatmentPlanId },
      data: {
        routine: {
          ...owned.plan,
          schedule,
          rescheduleBackups: recordRescheduleBackup(owned.plan, dateKey),
        },
      },
    }),
    prisma.dailyProgress.update({ where, data: { rescheduledAt: new Date() } }),
  ]);

  revalidatePath("/workspace");
  return { success: true, rescheduled: true, schedule };
}
