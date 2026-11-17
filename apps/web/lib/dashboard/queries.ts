import type { SessionUser } from "@/lib/auth/session";
import { toEscalation } from "@/lib/clinical/server-escalation";
import { prisma } from "@/lib/db/prisma";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import type { DashboardProgressRow, DashboardReport, DashboardSnapshot } from "./types";

/** How many past intakes the history list loads. */
const REPORT_LIMIT = 30;

function asPlan(value: unknown): StoredTreatmentPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<StoredTreatmentPlan>;
  const valid =
    typeof plan.durationMonths === "number" &&
    Array.isArray(plan.phases) &&
    Array.isArray(plan.steps);
  return valid ? (value as StoredTreatmentPlan) : null;
}

function asFeedback(value: string | null): DashboardProgressRow["feedback"] {
  return value === "relief" || value === "same" || value === "issue" ? value : null;
}

/** Everything the dashboard shows for one signed-in patient, read in three queries. */
export async function getDashboardSnapshot(user: SessionUser): Promise<DashboardSnapshot> {
  const rows = await prisma.clinicalReport.findMany({
    where: { patientId: user.id },
    orderBy: { createdAt: "desc" },
    take: REPORT_LIMIT,
    include: {
      treatmentPlan: { select: { routine: true, createdAt: true } },
      triageQuiz: { select: { id: true } },
    },
  });

  const reports: DashboardReport[] = rows.map((row) => {
    const categorized = new Set([...row.scanUrls, ...row.prescriptionUrls]);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      primarySymptoms: row.primarySymptoms,
      scanUrls: row.scanUrls,
      prescriptionUrls: row.prescriptionUrls,
      uncategorizedUrls: row.fileUrls.filter((url) => !categorized.has(url)),
      conditionTitle: row.conditionTitle,
      conditionSummary: row.conditionSummary,
      conditionSource: row.conditionSource,
      requiresInPersonCare: row.requiresInPersonCare,
      careReason: row.careReason,
      escalation: toEscalation(row),
      plan: asPlan(row.treatmentPlan?.routine),
      planCreatedAt: row.treatmentPlan?.createdAt.toISOString() ?? null,
      hasQuiz: row.triageQuiz !== null,
    };
  });

  const latestId = rows[0]?.id;
  const [progress, painEvents] = latestId
    ? await Promise.all([
        prisma.dailyProgress.findMany({
          where: { clinicalReportId: latestId },
          orderBy: { dateKey: "asc" },
        }),
        prisma.painEvent.findMany({
          where: { clinicalReportId: latestId },
          orderBy: { createdAt: "asc" },
        }),
      ])
    : [[], []];

  return {
    user: { name: user.name, email: user.email, role: user.role },
    reports,
    progress: progress.map((row) => ({
      dateKey: row.dateKey,
      completedExercises: row.completedExercises,
      completed: row.completedAt !== null,
      feedback: asFeedback(row.feedback),
      stopped: row.stoppedAt !== null,
    })),
    painEvents: painEvents.map((event) => ({
      dateKey: event.dateKey,
      painType: event.painType,
      regions: event.regions,
      exerciseNames: event.exerciseNames,
    })),
  };
}
