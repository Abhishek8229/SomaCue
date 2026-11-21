"use server";

import { revalidatePath } from "next/cache";
import { rescheduleTreatmentPlan } from "./generatePlan";
import { prisma } from "@/lib/db/prisma";
import { checkProgressEscalation } from "@/lib/clinical/server-escalation";
import { repairSchedule } from "@/lib/kinematics/plan-repair";
import {
  applyScheduleRestore,
  collectExerciseNames,
  dateKeySchema,
  feedbackSubmissionSchema,
  findRescheduleProblem,
  mergeRescheduledSchedule,
  recordRescheduleBackup,
  restoreScheduleForReset,
  withoutBackups,
  type ActionFailure,
  type FeedbackSubmission,
  type StoredTreatmentPlan,
  type ResetDayResult,
  type SubmitFeedbackResult,
  type ToggleExerciseResult,
} from "@/lib/progress/dailyProgress";
import { reconcileSchedule } from "@/lib/progress/schedule";
import {
  STOPPED_MESSAGE,
  fail,
  checkPlanDay,
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

  const blocked = await checkPlanDay(owned, dateKey);
  if (blocked) return blocked;

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

  const blocked = await checkPlanDay(owned, dateKey);
  if (blocked) return blocked;

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

  const blocked = await checkPlanDay(owned, dateKey);
  if (blocked) return blocked;

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

export type SyncScheduleResult =
  | { success: true; plan: StoredTreatmentPlan; skippedDateKeys: string[]; changed: boolean }
  | ActionFailure;

/**
 * Brings the saved schedule up to the calendar. Day 1 is the day the analysis
 * ran; working days that passed with no exercise done are moved forward so the
 * missed sessions are repeated. The browser sends its own local date.
 */
export async function syncSchedule(
  reportId: string,
  todayKey: string,
  fallbackStartKey: string,
): Promise<SyncScheduleResult> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) {
    return fail(owned.error);
  }

  const dateError = validateDateKey(todayKey);
  if (dateError) {
    return fail(dateError);
  }
  const startKey =
    dateKeySchema.safeParse(fallbackStartKey).success && fallbackStartKey <= todayKey ? fallbackStartKey : todayKey;

  const rows = await prisma.dailyProgress.findMany({
    where: { clinicalReportId: reportId },
    select: { dateKey: true, completedExercises: true, completedAt: true, stoppedAt: true },
  });
  const result = reconcileSchedule(
    owned.plan,
    rows.map((row) => ({
      dateKey: row.dateKey,
      completedExercises: row.completedExercises,
      completed: row.completedAt !== null,
      stopped: row.stoppedAt !== null,
    })),
    todayKey,
    startKey,
  );

  if (result.changed) {
    await prisma.treatmentPlan.update({
      where: { id: owned.treatmentPlanId },
      data: { routine: result.plan },
    });
  }

  return {
    success: true,
    plan: withoutBackups(result.plan),
    skippedDateKeys: result.skippedDateKeys,
    changed: result.changed,
  };
}

/** Hides the "day skipped" alert once the patient has read it. */
export async function dismissSkipNotice(reportId: string): Promise<{ success: true } | ActionFailure> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) {
    return fail(owned.error);
  }
  if (!owned.plan.skipNotice || owned.plan.skipNotice.dismissed) {
    return { success: true };
  }

  await prisma.treatmentPlan.update({
    where: { id: owned.treatmentPlanId },
    data: { routine: { ...owned.plan, skipNotice: { ...owned.plan.skipNotice, dismissed: true } } },
  });
  return { success: true };
}