import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/entitlements";
import { isProTier } from "@/lib/billing/plans";
import { redirect } from "next/navigation";
import type { TriageQuestion } from "@/actions/generatePlan";
import { isConditionSource, type DetectedCondition } from "@/lib/clinical/assessment";
import { toEscalation } from "@/lib/clinical/server-escalation";
import { reportFilesFromRecord } from "@/lib/intake/reportFiles";
import { parseDynamicPrecautions, parsePermanentPrecautions, type PlanPrecautions } from "@/lib/precautions/precautions";
import { legacyPrecautions } from "@/lib/precautions/server";
import { withoutBackups, type DailyProgressRecord, type StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import WorkspaceClient from "./WorkspaceClient";
import type { TreatmentPlanPayload } from "./WorkspaceParts";

function isTreatmentPlan(value: unknown): value is TreatmentPlanPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const plan = value as Record<string, unknown>;
  const phases = plan.phases;
  const steps = plan.steps;

  return (
    typeof plan.durationMonths === "number" &&
    Number.isInteger(plan.durationMonths) &&
    plan.durationMonths >= 1 &&
    Array.isArray(phases) &&
    phases.length === plan.durationMonths &&
    phases.every((phase) => {
      if (!phase || typeof phase !== "object") {
        return false;
      }

      const phaseData = phase as Record<string, unknown>;
      return typeof phaseData.phase === "string" && typeof phaseData.tagline === "string";
    }) &&
    Array.isArray(steps) &&
    steps.length === 3 &&
    steps.every((step) => {
      if (!step || typeof step !== "object") {
        return false;
      }

      const stepData = step as Record<string, unknown>;
      return (
        typeof stepData.exerciseName === "string" &&
        typeof stepData.animationTriggerId === "string" &&
        typeof stepData.durationSeconds === "number" &&
        Number.isFinite(stepData.durationSeconds) &&
        typeof stepData.voiceCue === "string"
      );
    })
  );
}

function isTriageQuestion(value: unknown): value is TriageQuestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const question = value as Record<string, unknown>;

  return (
    typeof question.id === "string" &&
    typeof question.question === "string" &&
    (question.answerType === "multiple_choice" || question.answerType === "short_text") &&
    (question.options === undefined ||
      (Array.isArray(question.options) &&
        question.options.every((option) => typeof option === "string")))
  );
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?next=/workspace");
  }

  // ?new=1 opens a blank intake, for "Start a new assessment" on the dashboard.
  // Nothing is created until the intake is submitted.
  const params = await searchParams;
  const startFresh = params.new === "1";
  // /workspace?upgrade=2m (from the pricing page) opens the Upgrade dialog on that tier.
  const upgradeParam = Array.isArray(params.upgrade) ? params.upgrade[0] : params.upgrade;
  const initialUpgradeTier = isProTier(upgradeParam) ? upgradeParam : null;

  const latestReport = startFresh
    ? null
    : await prisma.clinicalReport.findFirst({
        where: { patientId: user.id },
        orderBy: { createdAt: "desc" },
        include: {
          treatmentPlan: true,
          triageQuiz: true,
          dailyProgress: true,
          painEvents: { orderBy: { createdAt: "desc" } },
        },
      });

  const latestPainByDate = new Map<string, string[]>();
  for (const event of latestReport?.painEvents ?? []) {
    if (!latestPainByDate.has(event.dateKey)) latestPainByDate.set(event.dateKey, event.regions);
  }

  const initialProgress: DailyProgressRecord[] = (latestReport?.dailyProgress ?? []).map(
    (row) => ({
      dateKey: row.dateKey,
      completedExercises: row.completedExercises,
      completed: row.completedAt !== null,
      feedback:
        row.feedback === "relief" || row.feedback === "same" || row.feedback === "issue"
          ? row.feedback
          : null,
      stopped: row.stoppedAt !== null,
      stopRegions: row.stoppedAt !== null ? (latestPainByDate.get(row.dateKey) ?? []) : [],
    }),
  );

  const routine = isTreatmentPlan(latestReport?.treatmentPlan?.routine)
    ? withoutBackups(latestReport.treatmentPlan.routine)
    : null;
  const questions = Array.isArray(latestReport?.triageQuiz?.questions)
    ? latestReport.triageQuiz.questions.filter(isTriageQuestion)
    : [];
  const initialQuiz =
    latestReport?.triageQuiz && questions.length > 0
      ? {
          id: latestReport.triageQuiz.id,
          reportId: latestReport.id,
          questions,
        }
      : null;

  const reportFiles = latestReport ? reportFilesFromRecord(latestReport) : null;
  const initialIntake =
    latestReport && reportFiles
      ? {
          symptoms: latestReport.primarySymptoms,
          scanCount: reportFiles.scans.length,
          prescriptionCount: reportFiles.prescriptions.length,
          otherCount: reportFiles.uncategorized.length,
        }
      : null;

  const initialCondition: DetectedCondition | null =
    latestReport?.conditionTitle && latestReport.conditionSummary && isConditionSource(latestReport.conditionSource)
      ? {
          title: latestReport.conditionTitle,
          summary: latestReport.conditionSummary,
          source: latestReport.conditionSource,
          requiresInPersonCare: latestReport.requiresInPersonCare,
          careReason: latestReport.careReason,
        }
      : null;
  const initialEscalation = latestReport ? toEscalation(latestReport) : null;
  // Saved on the plan row with the analysis. A plan made before they existed (null columns) gets a fallback built
  // from the plan, its week and recent activity: no AI call, nothing written here. It is saved on the first interaction.
  const savedPermanent = parsePermanentPrecautions(latestReport?.treatmentPlan?.permanentPrecautions);
  const savedDynamic = parseDynamicPrecautions(latestReport?.treatmentPlan?.dynamicPrecautions);
  let initialPrecautions: PlanPrecautions | null = null;
  if (routine && latestReport?.treatmentPlan) {
    if (savedPermanent && savedDynamic) {
      initialPrecautions = { permanent: savedPermanent, dynamic: savedDynamic };
    } else {
      const stored = latestReport.treatmentPlan.routine as StoredTreatmentPlan;
      initialPrecautions = await legacyPrecautions(
        {
          reportId: latestReport.id,
          plan: stored,
          startDateKey: stored.startDateKey ?? latestReport.treatmentPlan.createdAt.toISOString().slice(0, 10),
          todayKey: new Date().toISOString().slice(0, 10),
        },
        { permanent: savedPermanent, dynamic: savedDynamic },
      );
    }
  }
  const initialBilling = await getBillingStatus(user.id);

  return (
    <WorkspaceClient
      initialBilling={initialBilling}
      initialPrecautions={initialPrecautions}
      initialUpgradeTier={initialUpgradeTier}
      userEmail={user.email}
      userName={user.name}
      planCreatedAt={routine ? (latestReport?.treatmentPlan?.createdAt.toISOString() ?? null) : null}
      hasActivePlan={routine !== null}
      initialProgress={initialProgress}
      initialCondition={initialCondition}
      initialEscalation={initialEscalation}
      initialIntake={initialIntake}
      initialQuiz={initialQuiz}
      reportId={latestReport?.id ?? null}
      routine={routine}
    />
  );
}
