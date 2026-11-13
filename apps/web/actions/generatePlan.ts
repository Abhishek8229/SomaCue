"use server";

import { BlobServiceClient } from "@azure/storage-blob";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";

const triageQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  question: z.string().min(1),
  answerType: z.enum(["multiple_choice", "short_text"]),
  options: z.array(z.string().min(1)).min(2).max(5).optional(),
});

const triageQuizSchema = z.array(triageQuestionSchema).min(6).max(12);

const treatmentStepSchema = z.object({
  exerciseName: z.string().min(1),
  animationTriggerId: z
    .string()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Must be lowercase snake_case"),
  durationSeconds: z.number().positive(),
  voiceCue: z.string().min(1),
});

const treatmentPhaseSchema = z.object({
  phase: z.string().min(1),
  tagline: z.string().min(1),
});

const scheduleDaySchema = z.object({
  dayOffset: z.number().int().min(0).max(6),
  status: z.enum(["active", "upcoming", "rest"]),
  focus: z.string().min(1),
  tagline: z.string().min(1),
});

const treatmentScheduleSchema = z
  .object({
    horizonDays: z.number().int().min(1).max(7),
    days: z.array(scheduleDaySchema).min(1).max(7),
  })
  .refine(
    (schedule) =>
      schedule.days.length === schedule.horizonDays &&
      new Set(schedule.days.map((day) => day.dayOffset)).size === schedule.days.length,
    {
      message: "The rolling schedule must contain one unique entry per horizon day.",
      path: ["days"],
    },
  );

const treatmentPlanSchema = z
  .object({
    durationMonths: z.number().int().min(1).max(12),
    phases: z.array(treatmentPhaseSchema).min(1).max(12),
    steps: z.array(treatmentStepSchema).length(3),
    schedule: treatmentScheduleSchema,
  })
  .refine((plan) => plan.phases.length === plan.durationMonths, {
    message: "There must be exactly one phase for each plan month.",
    path: ["phases"],
  });

const aiProvider = createOpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
});
const AI_REQUEST_TIMEOUT_MS = 60_000;

type MultimodalContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; image: string }
>;

function logAiFailure(error: unknown, operation: string) {
  console.error(`[SomaCue AI] ${operation} failed.`, {
    message: error instanceof Error ? error.message : String(error),
    statusCode:
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined,
  });
}

async function resolveReportDataUrl(fileUrl: string, abortSignal: AbortSignal) {
  if (fileUrl.startsWith("data:")) {
    return fileUrl;
  }

  let data: Buffer;
  let mediaType: string | undefined;

  if (fileUrl.startsWith("/")) {
    const filePath = join(process.cwd(), "public", fileUrl.slice(1));
    data = await readFile(filePath);
  } else {
    const response = await fetch(fileUrl, { signal: abortSignal });
    if (response.ok) {
      mediaType = response.headers.get("content-type")?.split(";")[0];
      data = Buffer.from(await response.arrayBuffer());
    } else {
      const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
      if (!connectionString) {
        throw new Error(`Unable to download report (${response.status}).`);
      }

      const reportUrl = new URL(fileUrl);
      const pathParts = reportUrl.pathname
        .split("/")
        .filter(Boolean)
        .map((part) => decodeURIComponent(part));
      const [containerName, ...blobNameParts] = pathParts;
      if (!containerName || blobNameParts.length === 0) {
        throw new Error(`Unable to resolve the Azure report path (${response.status}).`);
      }

      const blobClient = BlobServiceClient.fromConnectionString(connectionString)
        .getContainerClient(containerName)
        .getBlobClient(blobNameParts.join("/"));
      data = await blobClient.downloadToBuffer(0, undefined, { abortSignal });
    }
  }

  if (!mediaType) {
    const extension = extname(fileUrl).toLowerCase();
    mediaType =
      extension === ".pdf"
        ? "application/pdf"
        : extension === ".png"
          ? "image/png"
          : extension === ".webp"
            ? "image/webp"
            : "image/jpeg";
  }

  return `data:${mediaType};base64,${data.toString("base64")}`;
}

async function createMultimodalContent(
  text: string,
  fileUrls: string[],
  abortSignal: AbortSignal,
): Promise<MultimodalContent> {
  const reportDataUrls = await Promise.all(
    fileUrls.map((fileUrl) => resolveReportDataUrl(fileUrl, abortSignal)),
  );

  return [
    { type: "text", text },
    ...reportDataUrls.map((image) => ({ type: "image" as const, image })),
  ];
}

function createAiAbortSignal() {
  return AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
}

export type TriageQuestion = z.infer<typeof triageQuestionSchema>;
export type QuizAnswers = Record<string, string>;
export type TreatmentPlan = z.infer<typeof treatmentPlanSchema>;
export type TreatmentSchedule = z.infer<typeof treatmentScheduleSchema>;
export type AIProviderFailure = {
  success: false;
  error: "AI_PROVIDER_FAILED" | "AI_PROVIDER_TIMEOUT";
};

function getAiFailure(error: unknown): AIProviderFailure["error"] {
  return error instanceof DOMException && error.name === "TimeoutError"
    ? "AI_PROVIDER_TIMEOUT"
    : "AI_PROVIDER_FAILED";
}

export async function generateTriageQuiz(symptoms: string, fileUrls: string[]) {
  if (!symptoms.trim()) {
    throw new Error("Symptoms are required to generate triage questions.");
  }

  try {
    const abortSignal = createAiAbortSignal();
    const { object } = await generateObject({
      model: aiProvider.chat("nvidia/nemotron-3.5-super-vl:free"),
      abortSignal,
      maxRetries: 0,
      schema: triageQuizSchema,
      system: `You are a master clinical physiotherapist conducting a careful diagnostic triage.
You will receive patient symptoms and, when available, visual medical reports such as X-rays, MRIs,
and prescriptions. Analyze visual data only for physical rehabilitation constraints, red flags,
and safe follow-up questions. Do not diagnose.
Determine case complexity: simple, specific issues need 6 to 8 focused questions; complex or vague
issues may need 10 to 12 questions. Every question must materially improve rehabilitation safety or
personalization. Use multiple_choice for Yes/No/Not Sure or a small set of explicit options, and
short_text only when a free response is clinically useful. Use unique lowercase snake_case IDs.`,
      messages: [
        {
          role: "user",
          content: await createMultimodalContent(
            `Symptoms: ${symptoms.trim()}. Generate the tailored triage quiz now. Ask only the questions needed to safely plan rehabilitation.`,
            fileUrls,
            abortSignal,
          ),
        },
      ],
    });

    return { success: true, questions: object } as const;
  } catch (error) {
    logAiFailure(error, "Triage quiz generation");
    return { success: false, error: getAiFailure(error) } satisfies AIProviderFailure;
  }
}

export async function generateFinalRoutine(
  symptoms: string,
  fileUrls: string[],
  quizAnswers: QuizAnswers,
) {
  if (!symptoms.trim()) {
    throw new Error("Symptoms are required to generate a treatment plan.");
  }

  try {
    const abortSignal = createAiAbortSignal();
    const { object } = await generateObject({
      model: aiProvider.chat("nvidia/nemotron-3.5-super-vl:free"),
      abortSignal,
      maxRetries: 0,
      schema: treatmentPlanSchema,
      system: `You are a clinical physiotherapist. You will receive patient symptoms, visual medical reports
(X-rays, MRIs, prescriptions), and answers to a tailored triage quiz. Analyze the visual data strictly
for physical rehabilitation constraints and incorporate the quiz findings into a safe rehabilitation plan.
Avoid diagnosis, unsafe intensity, aggressive ranges of motion, and exercises that require equipment.
Choose the exact plan duration in whole months (1 to 12) based on case complexity. Return exactly one
phase object per plan month in chronological order, with a concise phase name and a patient-friendly
tagline that describes that month's progression. Also return exactly three simple, low-risk steps
with exerciseName, a lowercase snake_case animationTriggerId, realistic durationSeconds, and voiceCue
containing the exact spoken instruction for text-to-speech.
Return a rolling schedule for only the next 3 to 7 days, with one entry per day and dayOffset values
starting at 0 for today. Mark today active, future days upcoming, and recovery days rest. Each entry
must include a concise focus and patient-friendly tagline. Do not generate the full multi-month calendar.
If the answers or reports suggest a red flag or professional assessment, keep the routine gentle and
include a safety-oriented instruction in the voice cue. Return JSON with durationMonths, phases, steps,
and schedule.`,
      messages: [
        {
          role: "user",
          content: await createMultimodalContent(
            `Symptoms: ${symptoms.trim()}
Triage quiz answers: ${JSON.stringify(quizAnswers)}
Synthesize the final baseline rehabilitation timeline from all available evidence.`,
            fileUrls,
            abortSignal,
          ),
        },
      ],
    });

    return { success: true, routine: object } as const;
  } catch (error) {
    logAiFailure(error, "Final routine generation");
    return { success: false, error: getAiFailure(error) } satisfies AIProviderFailure;
  }
}

export async function rescheduleTreatmentPlan(
  symptoms: string,
  currentPlan: TreatmentPlan,
  feedback: "relief" | "same" | "issue",
) {
  try {
    const abortSignal = createAiAbortSignal();
    const { object } = await generateObject({
      model: aiProvider.chat("nvidia/nemotron-3.5-super-vl:free"),
      abortSignal,
      maxRetries: 0,
      schema: treatmentScheduleSchema,
      system: `You are a clinical physiotherapist updating a rolling rehabilitation schedule.
Return only the next 3 to 7 days, starting with dayOffset 0 for today. Keep one unique entry per
dayOffset, mark today active, future days upcoming, and recovery days rest. Rewrite the focus and
tagline conservatively in response to the patient's feedback. A pain spike or increased discomfort
requires a gentler schedule with recovery time and a safety-oriented focus. Do not diagnose.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Symptoms: ${symptoms.trim()}
Patient feedback: ${feedback}
Current treatment plan: ${JSON.stringify(currentPlan)}
Rewrite only the upcoming rolling schedule as safe JSON.`,
            },
          ],
        },
      ],
    });

    return { success: true, schedule: object } as const;
  } catch (error) {
    logAiFailure(error, "Treatment schedule rescheduling");
    return { success: false, error: getAiFailure(error) } satisfies AIProviderFailure;
  }
}
