"use server";

import { revalidatePath } from "next/cache";
import { rescheduleTreatmentPlan } from "./generatePlan";
import { prisma } from "@/lib/db/prisma";
import { checkProgressEscalation } from "@/lib/clinical/server-escalation";
import { repairSchedule, stripFlaggedMovements } from "@/lib/kinematics/plan-repair";
import type { Region } from "@/lib/kinematics/vocabulary";
import {
  collectExerciseNames,
  findRescheduleProblem,
  mergeRescheduledSchedule,
  recordRescheduleBackup,
  withoutBackups,
} from "@/lib/progress/dailyProgress";
import {
  PAIN_TYPE_LABELS,
  painReportSchema,
  type PainReport,
  type ReportPainResult,
  type ReschedulePainResult,
} from "@/lib/progress/painEvent";
import { refreshDynamicPrecautions } from "@/lib/precautions/server";
import { logRecoveryEvents } from "@/lib/recovery/server";
import { adjustEvent, painOverrideEvent } from "@/lib/recovery/timeline";
import { fail, loadOwnedPlan, validateDateKey } from "@/lib/progress/server-plan";

/**
 * Save a Pain Override report. The day is marked stopped (never completed)
 * and the report is saved before any AI work, so it can never be lost.
 */
export async function reportPainEvent(
  reportId: string,
  dateKey: string,
  report: PainReport,
): Promise<ReportPainResult> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) return fail(owned.error);

  const dateError = validateDateKey(dateKey);
  if (dateError) return fail(dateError);

  const parsed = painReportSchema.safeParse(report);
  if (!parsed.success) return fail("Please complete the report before saving.");

  const input = parsed.data;
  const known = collectExerciseNames(owned.plan);
  const exerciseNames = [...new Set(input.exerciseNames)];
  if (exerciseNames.some((name) => !known.has(name))) {
    return fail("Choose exercises from your plan.");
  }

  const now = new Date();
  const [event] = await prisma.$transaction([
    prisma.painEvent.create({
      data: {
        clinicalReportId: reportId,
        patientId: owned.userId,
        dateKey,
        exerciseNames,
        painType: input.painType,
        regions: [...new Set(input.regions)],
        details: input.details,
        context: input.context,
      },
    }),
    prisma.dailyProgress.upsert({
      where: { clinicalReportId_dateKey: { clinicalReportId: reportId, dateKey } },
      create: {
        clinicalReportId: reportId,
        patientId: owned.userId,
        dateKey,
        completedExercises: [],
        stoppedAt: now,
      },
      update: { stoppedAt: now },
    }),
  ]);

  // The stop is on the Recovery Timeline as soon as it is saved.
  await logRecoveryEvents(owned.userId, () =>
    painOverrideEvent({
      id: event.id,
      reportId,
      dateKey,
      painType: input.painType,
      regions: [...new Set(input.regions)],
      exerciseNames,
      details: input.details,
      at: event.createdAt,
    }),
  );

  revalidatePath("/workspace");
  const escalation = await checkProgressEscalation(reportId, dateKey);
  // The stop is saved. Now the dynamic precautions follow it, without an AI call and without ever failing the report.
  const dynamicPrecautions = await refreshDynamicPrecautions({
    treatmentPlanId: owned.treatmentPlanId,
    reportId,
    plan: owned.plan,
    startDateKey: owned.startDateKey,
    todayKey: dateKey,
    kind: "pain_override",
    patientId: owned.userId,
  });
  return { success: true, eventId: event.id, escalation, dynamicPrecautions };
}

/**
 * Rebuild tomorrow and the remaining horizon days after a red-flag stop.
 * Separate from reportPainEvent because the AI call can take up to two
 * minutes. Safe to retry: the first schedule backup for the day is kept.
 */
export async function reschedulePainEvent(reportId: string, eventId: string): Promise<ReschedulePainResult> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) return fail(owned.error);

  // Pain Override is safety care: stopping, reporting and rebuilding the plan around the report
  // are free for every plan, so there is deliberately no plan check here.

  if (typeof eventId !== "string" || !eventId) return fail("The stop report could not be found.");

  const event = await prisma.painEvent.findFirst({
    where: { id: eventId, clinicalReportId: reportId, patientId: owned.userId },
  });
  if (!event) return fail("The stop report could not be found.");

  const regions = event.regions as Region[];
  const painLabel = PAIN_TYPE_LABELS[event.painType as keyof typeof PAIN_TYPE_LABELS] ?? "Pain";
  const result = await rescheduleTreatmentPlan(owned.primarySymptoms, withoutBackups(owned.plan), {
    dateKey: event.dateKey,
    discomfortExercises: event.exerciseNames,
    discomfortDetails: `${painLabel}. ${event.details}`,
    redFlag: true,
    regions,
  });
  if (!result.success) {
    return { success: false, error: "Your report was saved, but the plan could not be updated.", aiError: result.error };
  }

  const problem = findRescheduleProblem(result.schedule, event.exerciseNames);
  if (problem) console.warn("[SomaCue AI] Red-flag reschedule repeated a reported exercise. Removing it.", { problem });

  const merged = mergeRescheduledSchedule(owned.plan.schedule, result.schedule);
  const repaired = await repairSchedule(merged, owned.plan);
  const schedule = stripFlaggedMovements(repaired, { exerciseNames: event.exerciseNames, regions });

  await prisma.$transaction([
    prisma.treatmentPlan.update({
      where: { id: owned.treatmentPlanId },
      data: {
        routine: {
          ...owned.plan,
          schedule,
          rescheduleBackups: recordRescheduleBackup(owned.plan, event.dateKey),
        },
      },
    }),
    prisma.painEvent.update({ where: { id: event.id }, data: { rescheduledAt: new Date() } }),
    prisma.dailyProgress.updateMany({
      where: { clinicalReportId: reportId, dateKey: event.dateKey },
      data: { rescheduledAt: new Date() },
    }),
  ]);

  await logRecoveryEvents(owned.userId, () => adjustEvent({ reportId, dateKey: event.dateKey, cause: "pain", at: new Date() }));

  revalidatePath("/workspace");
  return { success: true, schedule };
}
