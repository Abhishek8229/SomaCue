import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import type { TriageQuestion } from "@/actions/generatePlan";
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

export default async function WorkspacePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?from=/workspace");
  }

  const latestReport = await prisma.clinicalReport.findFirst({
    where: { patientId: user.id },
    orderBy: { createdAt: "desc" },
    include: { treatmentPlan: true, triageQuiz: true },
  });

  const routine = isTreatmentPlan(latestReport?.treatmentPlan?.routine)
    ? latestReport.treatmentPlan.routine
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

  return (
    <WorkspaceClient
      hasActivePlan={routine !== null}
      initialQuiz={initialQuiz}
      reportId={latestReport?.id ?? null}
      routine={routine}
    />
  );
}
