import { prisma } from "@/lib/db/prisma";
import { resolveStageExercise } from "@/lib/kinematics/exercise";
import { reportFilesFromRecord } from "@/lib/intake/reportFiles";
import { getDayExercises, type StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import { isConditionSource, type DetectedCondition } from "./assessment";
import type { ChatContext } from "./chatGuardrails";
import { toEscalation } from "./server-escalation";

/**
 * Server-only. Loads the patient's clinical context for the Rehab Companion.
 * Returns null when the report does not belong to the user.
 */
export async function loadChatContext(
  userId: string,
  userName: string | null,
  reportId: string | null,
): Promise<ChatContext | null> {
  const empty: ChatContext = {
    patientName: userName,
    condition: null,
    escalation: null,
    plan: null,
    todayFocus: null,
    todayExercises: [],
    recentSessions: [],
    painStops: [],
    uploads: { scans: 0, prescriptions: 0 },
  };
  if (!reportId) return empty;

  const report = await prisma.clinicalReport.findFirst({
    where: { id: reportId, patientId: userId },
    include: {
      treatmentPlan: true,
      dailyProgress: { orderBy: { dateKey: "desc" }, take: 7 },
      painEvents: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!report) return null;

  const condition: DetectedCondition | null =
    report.conditionTitle && report.conditionSummary && isConditionSource(report.conditionSource)
      ? {
          title: report.conditionTitle,
          summary: report.conditionSummary,
          source: report.conditionSource,
          requiresInPersonCare: report.requiresInPersonCare,
          careReason: report.careReason,
        }
      : null;

  const plan = report.treatmentPlan?.routine as StoredTreatmentPlan | null | undefined;
  const validPlan = plan && Array.isArray(plan.steps) && Array.isArray(plan.phases) ? plan : null;
  // The rolling schedule starts today, so day offset 0 is today's session.
  const days = [...(validPlan?.schedule?.days ?? [])].sort((a, b) => a.dayOffset - b.dayOffset);
  const today = days.find((day) => day.dayOffset === 0);
  const todaySteps = validPlan ? getDayExercises(validPlan, today) : [];
  const files = reportFilesFromRecord(report);

  return {
    ...empty,
    condition,
    escalation: toEscalation(report),
    plan: validPlan
      ? {
          durationMonths: validPlan.durationMonths,
          phases: validPlan.phases,
          days: days.map((day) => ({ dayOffset: day.dayOffset, status: day.status, focus: day.focus })),
        }
      : null,
    todayFocus: today?.focus ?? null,
    todayExercises: todaySteps.map((step) => {
      const { spec } = resolveStageExercise(step);
      return {
        name: step.exerciseName,
        sets: spec?.sets ?? null,
        reps: spec?.reps ?? null,
        durationSeconds: step.durationSeconds ?? null,
        cues: [step.voiceCue, ...(spec?.cues ?? [])],
        stopIf: spec?.stopIf ?? [],
      };
    }),
    recentSessions: report.dailyProgress.map((row) => ({
      dateKey: row.dateKey,
      feedback: row.feedback,
      notes: row.notes ?? row.discomfortDetails,
    })),
    painStops: report.painEvents.map((event) => ({
      dateKey: event.dateKey,
      painType: event.painType,
      regions: event.regions,
      details: event.details,
    })),
    uploads: {
      scans: files.scans.length + files.uncategorized.length,
      prescriptions: files.prescriptions.length,
    },
  };
}
