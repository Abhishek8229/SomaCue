"use server";

import { revalidatePath } from "next/cache";
import {
  generateFinalRoutine,
  generateTriageQuiz,
  type QuizAnswers,
  type TriageQuestion,
} from "./generatePlan";
import { getCurrentUser } from "@/lib/auth/session";
import { checkAnalysisAllowed } from "@/lib/billing/entitlements";
import { initialPrecautions } from "@/lib/precautions/precautions";
import {
  deriveConditionSource,
  screenQuizAnswers,
  screenRedFlags,
  type DetectedCondition,
  type Escalation,
} from "@/lib/clinical/assessment";
import { toEscalation } from "@/lib/clinical/server-escalation";
import { prisma } from "@/lib/db/prisma";
import {
  MAX_FILES_PER_CATEGORY,
  isTrustedUploadUrl,
  reportFilesFromRecord,
} from "@/lib/intake/reportFiles";
import { storeUpload } from "@/lib/intake/storage";
import { validateUploadFile } from "@/lib/intake/uploadGuard";
import { repairPlan } from "@/lib/kinematics/plan-repair";
import { recordAnalysis, recordPlan, reportHasPlan } from "@/lib/recovery/server";

function readUploadUrls(formData: FormData, field: string) {
  const urls = [
    ...new Set(
      formData
        .getAll(field)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  ];

  if (urls.length > MAX_FILES_PER_CATEGORY) {
    throw new Error(`Upload at most ${MAX_FILES_PER_CATEGORY} files in each section.`);
  }
  if (!urls.every(isTrustedUploadUrl)) {
    throw new Error("One of the uploaded files could not be verified. Please upload it again.");
  }

  return urls;
}

export async function submitIntakeForm(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to submit an intake.");
  }

  // Free: one Discovery analysis. A new one (re-run) is Pro. Checked here, not just in the UI,
  // because a server action can be called directly.
  const blocked = await checkAnalysisAllowed(user.id);
  if (blocked) {
    return { success: false, error: blocked.error, feature: blocked.feature } as const;
  }

  const primarySymptoms = formData.get("primarySymptoms");
  const scanFile = formData.get("scanFile");

  if (typeof primarySymptoms !== "string" || primarySymptoms.trim().length === 0) {
    throw new Error("Primary symptoms are required.");
  }

  const scanUrls = readUploadUrls(formData, "scanUrl");
  const prescriptionUrls = readUploadUrls(formData, "prescriptionUrl");

  if (scanUrls.length === 0 && prescriptionUrls.length === 0 && scanFile instanceof File && scanFile.size > 0) {
    const check = validateUploadFile(scanFile);
    if (!check.ok) throw new Error(check.error);
    scanUrls.push((await storeUpload(scanFile)).url);
  }

  // Without a clinician's prescription the patient must acknowledge the AI's limits.
  const disclaimerAccepted = formData.get("aiDisclaimerAccepted") === "true";
  if (prescriptionUrls.length === 0 && !disclaimerAccepted) {
    throw new Error(
      "Please confirm that you understand the limits of AI analysis without a prescription.",
    );
  }

  const files = { scans: scanUrls, prescriptions: prescriptionUrls, uncategorized: [] };
  const report = await prisma.clinicalReport.create({
    data: {
      patientId: user.id,
      primarySymptoms: primarySymptoms.trim(),
      fileUrls: [...scanUrls, ...prescriptionUrls],
      scanUrls,
      prescriptionUrls,
      aiDisclaimerAcceptedAt: prescriptionUrls.length === 0 ? new Date() : null,
      adaptiveData: {},
    },
  });

  const triageResult = await generateTriageQuiz(primarySymptoms.trim(), files);
  const screenedFlags = screenRedFlags(primarySymptoms);
  if (!triageResult.success && screenedFlags.length === 0) {
    return triageResult;
  }

  const source = deriveConditionSource(files);
  const assessment = triageResult.success ? triageResult.assessment : null;
  const redFlags = [...new Set([...screenedFlags, ...(assessment?.redFlags ?? [])])];
  const requiresInPersonCare = assessment?.manageableWithGuidedRehab === false || screenedFlags.length > 0;
  const careReason =
    assessment && !assessment.manageableWithGuidedRehab
      ? assessment.safetyReasoning
      : screenedFlags.length > 0
        ? `Your description mentions warning signs (${screenedFlags.join("; ").toLowerCase()}) that always need an in-person medical evaluation before any exercise.`
        : (assessment?.safetyReasoning ?? null);
  const condition: DetectedCondition = {
    title: assessment?.conditionTitle ?? "Warning signs that need in-person care",
    summary:
      assessment?.conditionSummary ??
      "Your symptoms include warning signs that can point to a serious problem. These need to be examined in person before any exercise programme is started.",
    source,
    requiresInPersonCare,
    careReason,
  };
  const escalatedAt = requiresInPersonCare ? new Date() : null;

  // The first line of the Recovery Timeline. Logging never fails the analysis.
  await recordAnalysis(user.id, {
    id: report.id,
    createdAt: report.createdAt,
    primarySymptoms: report.primarySymptoms,
    conditionTitle: condition.title,
    conditionSummary: condition.summary,
  });

  await prisma.clinicalReport.update({
    where: { id: report.id },
    data: {
      conditionTitle: condition.title,
      conditionSummary: condition.summary,
      conditionSource: source,
      requiresInPersonCare,
      careReason,
      ...(escalatedAt
        ? {
            escalationKind: "triage",
            escalationReason: careReason,
            escalationEvidence: redFlags,
            escalatedAt,
          }
        : {}),
    },
  });

  // A case that needs in-person care gets no quiz and no exercise plan.
  if (escalatedAt || !triageResult.success) {
    revalidatePath("/workspace");
    return {
      success: true,
      reportId: report.id,
      quizId: null,
      questions: [] as TriageQuestion[],
      condition,
      escalation: {
        kind: "triage",
        reason: careReason ?? "This case needs an in-person medical evaluation.",
        evidence: redFlags,
        escalatedAt: (escalatedAt ?? new Date()).toISOString(),
      } satisfies Escalation,
    } as const;
  }

  const triageQuiz = await prisma.triageQuiz.create({
    data: {
      clinicalReportId: report.id,
      questions: triageResult.questions,
    },
  });

  revalidatePath("/workspace");

  return {
    success: true,
    reportId: report.id,
    quizId: triageQuiz.id,
    questions: triageResult.questions,
    condition,
    escalation: null,
  } as const;
}

export async function completeTriageQuiz(
  reportId: string,
  quizId: string,
  quizAnswers: QuizAnswers,
) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to complete triage.");
  }

  const quiz = await prisma.triageQuiz.findUnique({
    where: { id: quizId },
    include: { clinicalReport: true },
  });

  if (
    !quiz ||
    quiz.clinicalReportId !== reportId ||
    quiz.clinicalReport.patientId !== user.id
  ) {
    throw new Error("The triage quiz could not be found.");
  }

  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
  const questionIds = new Set(
    questions.flatMap((question) => {
      if (
        question &&
        typeof question === "object" &&
        "id" in question &&
        typeof question.id === "string"
      ) {
        return [question.id];
      }

      return [];
    }),
  );
  const answers = Object.entries(quizAnswers).filter(
    ([questionId, answer]) => questionIds.has(questionId) && answer.trim().length > 0,
  );

  if (answers.length !== questionIds.size) {
    throw new Error("Please answer every triage question before continuing.");
  }

  await prisma.$transaction(
    answers.map(([questionId, answer]) =>
      prisma.quizAnswer.upsert({
        where: {
          triageQuizId_questionId: {
            triageQuizId: quiz.id,
            questionId,
          },
        },
        create: {
          triageQuizId: quiz.id,
          questionId,
          answer: answer.trim(),
        },
        update: { answer: answer.trim() },
      }),
    ),
  );

  const existingEscalation = toEscalation(quiz.clinicalReport);
  if (existingEscalation) {
    return { success: true, treatmentPlanId: null, routine: null, escalation: existingEscalation } as const;
  }

  // Red flags revealed by the answers lock the case before any plan is generated.
  const answeredQuestions = answers.map(([questionId, answer]) => {
    const question = questions.find(
      (entry) => entry && typeof entry === "object" && "id" in entry && entry.id === questionId,
    ) as { question?: unknown } | undefined;
    return { question: typeof question?.question === "string" ? question.question : "", answer };
  });
  const answerFlags = screenQuizAnswers(answeredQuestions);
  if (answerFlags.length > 0) {
    const escalatedAt = new Date();
    const reason = `Your answers point to warning signs (${answerFlags.join("; ").toLowerCase()}) that need an in-person medical evaluation before any exercise.`;
    await prisma.clinicalReport.update({
      where: { id: reportId },
      data: {
        requiresInPersonCare: true,
        careReason: reason,
        escalationKind: "triage",
        escalationReason: reason,
        escalationEvidence: answerFlags,
        escalatedAt,
      },
    });
    revalidatePath("/workspace");
    return {
      success: true,
      treatmentPlanId: null,
      routine: null,
      escalation: {
        kind: "triage",
        reason,
        evidence: answerFlags,
        escalatedAt: escalatedAt.toISOString(),
      } satisfies Escalation,
    } as const;
  }

  const routineResult = await generateFinalRoutine(
    quiz.clinicalReport.primarySymptoms,
    reportFilesFromRecord(quiz.clinicalReport),
    Object.fromEntries(answers),
  );
  if (!routineResult.success) {
    return routineResult;
  }

  // Validate and clamp every movement on the real body before saving.
  const routine = await repairPlan(routineResult.routine);

  // The precautions came with the plan in the same AI response. They are saved on the plan row, so
  // /workspace loads them straight from the database. A re-run replaces both lists with the new ones.
  const precautions = initialPrecautions(routineResult.precautions);
  const isRerun = await reportHasPlan(reportId);
  const treatmentPlan = await prisma.treatmentPlan.upsert({
    where: { clinicalReportId: reportId },
    create: {
      clinicalReportId: reportId,
      routine,
      permanentPrecautions: precautions.permanent,
      dynamicPrecautions: precautions.dynamic,
    },
    update: {
      routine,
      permanentPrecautions: precautions.permanent,
      dynamicPrecautions: precautions.dynamic,
      createdAt: new Date(),
    },
  });

  // Logged as it happens, so a later re-run cannot erase this plan from the timeline.
  await recordPlan(user.id, {
    reportId,
    createdAt: treatmentPlan.createdAt,
    plan: routine,
    rerun: isRerun,
  });

  revalidatePath("/workspace");

  return {
    success: true,
    treatmentPlanId: treatmentPlan.id,
    routine,
    precautions,
    escalation: null,
  } as const;
}
