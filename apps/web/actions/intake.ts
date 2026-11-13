"use server";

import { BlobServiceClient } from "@azure/storage-blob";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { revalidatePath } from "next/cache";
import {
  generateFinalRoutine,
  generateTriageQuiz,
  rescheduleTreatmentPlan,
  type QuizAnswers,
  type TreatmentPlan,
} from "./generatePlan";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

async function saveLocalUpload(file: File) {
  const uploadsDirectory = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDirectory, { recursive: true });

  const extension = extname(file.name).replace(/[^a-zA-Z0-9.]/g, "");
  const fileName = `${randomUUID()}${extension}`;
  await writeFile(join(uploadsDirectory, fileName), Buffer.from(await file.arrayBuffer()));

  return `/uploads/${fileName}`;
}

async function uploadFileToAzure(file: File) {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A non-empty file is required.");
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  if (!connectionString) {
    console.warn("[SomaCue upload] Azure storage is not configured; using local upload fallback.");
    return { url: await saveLocalUpload(file), storage: "local" as const };
  }

  try {
    const extension = extname(file.name).replace(/[^a-zA-Z0-9.]/g, "");
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient("patient-scans");
    const blockBlobClient = containerClient.getBlockBlobClient(`${randomUUID()}${extension}`);

    await blockBlobClient.uploadData(Buffer.from(await file.arrayBuffer()));
    return { url: blockBlobClient.url, storage: "azure" as const };
  } catch (error) {
    const details =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };
    console.error("[SomaCue upload] Azure Blob upload failed.", {
      fileName: file.name,
      fileSize: file.size,
      ...details,
    });

    if (process.env.ALLOW_LOCAL_UPLOAD_FALLBACK !== "false") {
      console.warn("[SomaCue upload] Using local upload fallback after Azure failure.");
      return { url: await saveLocalUpload(file), storage: "local" as const };
    }

    throw new Error(`Azure upload failed: ${details.message}`);
  }
}

export async function uploadScanFile(formData: FormData) {
  const scanFile = formData.get("scanFile");

  if (!(scanFile instanceof File) || scanFile.size === 0) {
    throw new Error("A non-empty file is required.");
  }

  return {
    success: true,
    ...(await uploadFileToAzure(scanFile)),
  };
}

export async function submitIntakeForm(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to submit an intake.");
  }

  const primarySymptoms = formData.get("primarySymptoms");
  const scanFile = formData.get("scanFile");

  if (typeof primarySymptoms !== "string" || primarySymptoms.trim().length === 0) {
    throw new Error("Primary symptoms are required.");
  }

  const submittedFileUrls = formData
    .getAll("fileUrl")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const azureFileUrls = [...new Set(submittedFileUrls)];

  if (azureFileUrls.length === 0 && scanFile instanceof File && scanFile.size > 0) {
    azureFileUrls.push((await uploadFileToAzure(scanFile)).url);
  }

  const report = await prisma.clinicalReport.create({
    data: {
      patientId: user.id,
      primarySymptoms: primarySymptoms.trim(),
      fileUrls: azureFileUrls,
      adaptiveData: {},
    },
  });

  const triageResult = await generateTriageQuiz(primarySymptoms.trim(), azureFileUrls);
  if (!triageResult.success) {
    return triageResult;
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
  };
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

  const routineResult = await generateFinalRoutine(
    quiz.clinicalReport.primarySymptoms,
    quiz.clinicalReport.fileUrls,
    Object.fromEntries(answers),
  );
  if (!routineResult.success) {
    return routineResult;
  }

  const treatmentPlan = await prisma.treatmentPlan.upsert({
    where: { clinicalReportId: reportId },
    create: { clinicalReportId: reportId, routine: routineResult.routine },
    update: { routine: routineResult.routine, createdAt: new Date() },
  });

  revalidatePath("/workspace");

  return {
    success: true,
    treatmentPlanId: treatmentPlan.id,
    routine: routineResult.routine,
  };
}

export async function reschedulePlanFromFeedback(
  reportId: string,
  feedback: "relief" | "same" | "issue",
) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("You must be signed in to reschedule triage.");
  }

  const report = await prisma.clinicalReport.findFirst({
    where: { id: reportId, patientId: user.id },
    include: { treatmentPlan: true },
  });

  if (!report?.treatmentPlan) {
    throw new Error("The active treatment plan could not be found.");
  }

  const currentPlan = report.treatmentPlan.routine as TreatmentPlan;
  const scheduleResult = await rescheduleTreatmentPlan(
    report.primarySymptoms,
    currentPlan,
    feedback,
  );
  if (!scheduleResult.success) {
    return scheduleResult;
  }

  const updatedRoutine = {
    ...currentPlan,
    schedule: scheduleResult.schedule,
  };
  await prisma.treatmentPlan.update({
    where: { id: report.treatmentPlan.id },
    data: { routine: updatedRoutine, createdAt: new Date() },
  });

  revalidatePath("/workspace");

  return {
    success: true,
    schedule: scheduleResult.schedule,
  } as const;
}
