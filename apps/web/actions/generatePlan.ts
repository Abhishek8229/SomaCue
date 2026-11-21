/*
 * AI generation for intake, the routine and rescheduling. Deliberately NOT a "use server"
 * module: those exports would be public endpoints anyone could call, with no sign-in
 * and no plan check. They are plain server-side functions, called only from the server
 * actions in intake.ts, dailyProgress.ts and painEvent.ts, which check both first.
 */

import { BlobServiceClient } from "@azure/storage-blob";
import { generateObject } from "ai";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { getAiModel } from "@/lib/ai/client";
import { movementSpecSchema } from "@/lib/kinematics/movement-spec";
import { isTrustedUploadUrl, type ReportFiles } from "@/lib/intake/reportFiles";
import { REFERENCE_EXERCISES } from "@/lib/kinematics/reference-exercises";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";

const triageQuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  question: z.string().min(1),
  answerType: z.enum(["multiple_choice", "short_text"]),
  options: z.array(z.string().min(1)).min(2).max(5).optional(),
});

const triageQuizSchema = z.array(triageQuestionSchema).min(6).max(12);

const triageAssessmentSchema = z.object({
  conditionTitle: z.string().min(1).max(90),
  conditionSummary: z.string().min(1).max(700),
  manageableWithGuidedRehab: z.boolean(),
  safetyReasoning: z.string().min(1).max(700),
  redFlags: z.array(z.string().min(1).max(160)).max(8),
});

const triageResultSchema = z.object({
  assessment: triageAssessmentSchema,
  questions: triageQuizSchema,
});

export type TriageAssessment = z.infer<typeof triageAssessmentSchema>;

const treatmentStepSchema = z.object({
  exerciseName: z.string().min(1),
  animationTriggerId: z
    .string()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, "Must be lowercase snake_case"),
  durationSeconds: z.number().positive(),
  voiceCue: z.string().min(1),
  /** Textbook description the 3D engine animates. Optional for older plans. */
  movement: movementSpecSchema.optional(),
});

// New plans must describe every exercise for the 3D engine.
const aiTreatmentStepSchema = treatmentStepSchema.extend({ movement: movementSpecSchema });

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

const hasOneEntryPerHorizonDay = (schedule: {
  horizonDays: number;
  days: Array<{ dayOffset: number }>;
}) =>
  schedule.days.length === schedule.horizonDays &&
  new Set(schedule.days.map((day) => day.dayOffset)).size === schedule.days.length;

const oneEntryPerHorizonDayIssue = {
  message: "The rolling schedule must contain one unique entry per horizon day.",
  path: ["days"],
};

const treatmentScheduleSchema = z
  .object({
    horizonDays: z.number().int().min(1).max(7),
    days: z.array(scheduleDaySchema).min(1).max(7),
  })
  .refine(hasOneEntryPerHorizonDay, oneEntryPerHorizonDayIssue);

// Rescheduled days carry their own exercises. The array is required (empty for
// rest days) because optional fields are less reliable in structured output.
const rescheduledScheduleSchema = z
  .object({
    horizonDays: z.number().int().min(1).max(7),
    days: z
      .array(scheduleDaySchema.extend({ steps: z.array(treatmentStepSchema).max(5) }))
      .min(1)
      .max(7),
  })
  .refine(hasOneEntryPerHorizonDay, oneEntryPerHorizonDayIssue);

// Kept as the source of the stored TreatmentPlan type (movement optional for older plans).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

const aiTreatmentPlanSchema = z
  .object({
    durationMonths: z.number().int().min(1).max(12),
    phases: z.array(treatmentPhaseSchema).min(1).max(12),
    steps: z.array(aiTreatmentStepSchema).length(3),
    schedule: treatmentScheduleSchema,
  })
  .refine((plan) => plan.phases.length === plan.durationMonths, {
    message: "There must be exactly one phase for each plan month.",
    path: ["phases"],
  });

const PRESS_UP_EXAMPLE = JSON.stringify(
  REFERENCE_EXERCISES.find((exercise) => exercise.id === "prone_press_up")?.spec,
);

/** Shared instructions that teach the model the motion vocabulary. */
const MOVEMENT_INSTRUCTIONS = `Describe each exercise in a "movement" object using textbook biomechanics so a
3D figure can perform it live. Never use bone names or coordinates.
- posture: standing, seated, supine, prone or quadruped.
- startPose: positions held for the whole exercise, for example hook lying is hip flexion 45 and
  knee flexion 90 with side both. Use [] for the relaxed posture.
- movements: the end position of each rep as angles from anatomical zero. Each rep moves from the
  start pose to this position and back.
- Each angle entry has segment (cervical, thoracic, lumbar, pelvis, scapula, shoulder, elbow,
  forearm, wrist, hip, knee, ankle), motion (flexion, extension, lateral_flexion, rotation,
  retraction, anterior_tilt, posterior_tilt, elevation, depression, protraction, abduction,
  adduction, horizontal_abduction, horizontal_adduction, internal_rotation, external_rotation,
  pronation, supination, radial_deviation, ulnar_deviation, dorsiflexion, plantarflexion,
  inversion, eversion), side (left, right or both; for spine lateral_flexion and rotation the
  direction) and degrees. Use gentle, pain-free angles well inside normal range.
- alternateSides mirrors left and right on every other rep. pins lists hands or feet that stay
  planted (left_hand, right_hand, left_foot, right_foot).
- tempo in seconds (upSeconds, holdSeconds, downSeconds, restSeconds), reps, sets.
- targetRegions from: head, cervical, thoracic, lumbar, pelvis, shoulder_left, shoulder_right,
  elbow_left, elbow_right, wrist_hand_left, wrist_hand_right, hip_left, hip_right, knee_left,
  knee_right, ankle_foot_left, ankle_foot_right.
- cues and stopIf are short patient-friendly sentences.
Example for a prone press-up (back extension): ${PRESS_UP_EXAMPLE}`;

const AI_REQUEST_TIMEOUT_MS = 60_000;
// Rescheduling and the final routine include movement descriptions for the 3D
// engine. A live red-flag reschedule took 117 seconds on the free model, so both
// get three minutes. Hosting must allow server actions to run this long.
const AI_RESCHEDULE_TIMEOUT_MS = 180_000;
const AI_ROUTINE_TIMEOUT_MS = 180_000;

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
  files: ReportFiles,
  abortSignal: AbortSignal,
): Promise<MultimodalContent> {
  const groups = [
    // Prescriptions first: they are the primary clinical evidence.
    {
      label: "Clinical prescriptions & notes from a doctor, physiotherapist or other clinician (primary evidence)",
      urls: files.prescriptions,
    },
    { label: "Medical scans / imaging (MRI, X-ray, CT)", urls: files.scans },
    { label: "Medical reports (uncategorized)", urls: files.uncategorized },
  ].filter((group) => group.urls.length > 0);

  for (const group of groups) {
    const rejected = group.urls.filter((url) => !isTrustedUploadUrl(url));
    if (rejected.length > 0) {
      console.warn(`[SomaCue AI] Skipping ${rejected.length} file(s) that did not come from the upload action.`);
      group.urls = group.urls.filter(isTrustedUploadUrl);
    }
  }

  const resolved = await Promise.all(
    groups.filter((group) => group.urls.length > 0).map(async (group) => ({
      label: group.label,
      images: await Promise.all(group.urls.map((url) => resolveReportDataUrl(url, abortSignal))),
    })),
  );

  return [
    { type: "text", text },
    ...resolved.flatMap((group): MultimodalContent => [
      { type: "text", text: `${group.label}: ${group.images.length} file(s) follow.` },
      ...group.images.map((image) => ({ type: "image" as const, image })),
    ]),
  ];
}

/** Tells the model what evidence it has, so it can weigh it correctly. */
function describeEvidence(files: ReportFiles) {
  const parts = [
    `${files.scans.length} medical scan/imaging file(s)`,
    `${files.prescriptions.length} clinician prescription/note file(s)`,
  ];
  if (files.uncategorized.length > 0) parts.push(`${files.uncategorized.length} uncategorized report(s)`);

  const guidance =
    files.prescriptions.length > 0
      ? "Treat the clinician's prescription and notes as the primary guidance and stay within any limits they set."
      : "No clinician prescription was provided and the patient has acknowledged that AI analysis without a physical evaluation may not be completely accurate. Be especially conservative.";

  return `Evidence provided: ${parts.join(", ")}. ${guidance}`;
}

function createAiAbortSignal(timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

export type TriageQuestion = z.infer<typeof triageQuestionSchema>;
export type QuizAnswers = Record<string, string>;
export type TreatmentPlan = z.infer<typeof treatmentPlanSchema>;
export type TreatmentSchedule = z.infer<typeof treatmentScheduleSchema>;
export type DiscomfortReport = {
  dateKey: string;
  discomfortExercises: string[];
  discomfortDetails: string;
  notes?: string;
  /** A Pain Override stop: sharp pain or sudden loss of movement. */
  redFlag?: boolean;
  /** Body regions the patient reported, from the motion vocabulary. */
  regions?: string[];
};
export type AIProviderFailure = {
  success: false;
  error: "AI_PROVIDER_FAILED" | "AI_PROVIDER_TIMEOUT";
};

function getAiFailure(error: unknown): AIProviderFailure["error"] {
  return error instanceof DOMException && error.name === "TimeoutError"
    ? "AI_PROVIDER_TIMEOUT"
    : "AI_PROVIDER_FAILED";
}

export async function generateTriageQuiz(symptoms: string, files: ReportFiles) {
  if (!symptoms.trim()) {
    throw new Error("Symptoms are required to generate triage questions.");
  }

  try {
    const abortSignal = createAiAbortSignal();
    const { object } = await generateObject({
      model: getAiModel(),
      abortSignal,
      maxRetries: 0,
      schema: triageResultSchema,
      system: `You are a master clinical physiotherapist conducting a careful diagnostic triage.
You will receive patient symptoms and, when available, clinical prescriptions & notes from a doctor or
physiotherapist and medical scans such as X-rays, MRIs and CT scans.

1. Identify the condition, using the evidence in this strict priority order:
   a. Clinical prescriptions & notes are the primary clinical truth. If they name a diagnosis or
      condition, use exactly that condition.
   b. Only if no prescription or notes were provided, infer the most likely condition from the
      medical scans together with the symptom description.
   c. With only a symptom description, infer the most likely condition and describe it as likely.
   Return conditionTitle as a short specific name (for example "L4–L5 disc bulge" or
   "Patellofemoral pain syndrome") and conditionSummary as 2 to 3 plain-language sentences explaining
   what the condition is and how it typically affects movement. Never invent findings that are not in
   the evidence.
2. Decide whether the case is safely manageable with guided self-rehabilitation and online
   physiotherapy. Set manageableWithGuidedRehab to false when anything suggests the patient needs
   urgent or in-person medical care, including: red-flag neurological signs (loss of bladder or bowel
   control, numbness in the groin or saddle area, progressive or significant weakness, foot drop),
   suspected or confirmed fracture, acute tendon or ligament rupture or complete tear, severe
   structural damage or instability, signs of infection, tumour or inflammatory disease, severe
   unrelenting night pain, pain after major trauma, or chest pain. When unsure, choose false.
   Explain the decision in safetyReasoning in 1 to 3 plain sentences that refer to this patient's own
   evidence, and list any warning signs found in redFlags (use [] if none).
3. Write the follow-up questions. Simple, specific issues need 6 to 8 focused questions; complex or
   vague issues may need 10 to 12. Every question must materially improve rehabilitation safety or
   personalization. Use multiple_choice for Yes/No/Not Sure or a small set of explicit options, and
   short_text only when a free response is clinically useful. Use unique lowercase snake_case IDs.`,
      messages: [
        {
          role: "user",
          content: await createMultimodalContent(
            `Symptoms: ${symptoms.trim()}.
${describeEvidence(files)}
Generate the condition assessment and the tailored triage quiz now. Ask only the questions needed to safely plan rehabilitation.`,
            files,
            abortSignal,
          ),
        },
      ],
    });

    return { success: true, questions: object.questions, assessment: object.assessment } as const;
  } catch (error) {
    logAiFailure(error, "Triage quiz generation");
    return { success: false, error: getAiFailure(error) } satisfies AIProviderFailure;
  }
}

export async function generateFinalRoutine(
  symptoms: string,
  files: ReportFiles,
  quizAnswers: QuizAnswers,
) {
  if (!symptoms.trim()) {
    throw new Error("Symptoms are required to generate a treatment plan.");
  }

  try {
    const abortSignal = createAiAbortSignal(AI_ROUTINE_TIMEOUT_MS);
    const { object } = await generateObject({
      model: getAiModel(),
      abortSignal,
      maxRetries: 0,
      schema: aiTreatmentPlanSchema,
      system: `You are a clinical physiotherapist. You will receive patient symptoms, visual medical reports
(X-rays, MRIs, prescriptions), and answers to a tailored triage quiz. Analyze the visual data strictly
for physical rehabilitation constraints and incorporate the quiz findings into a safe rehabilitation plan.
Avoid diagnosis, unsafe intensity, aggressive ranges of motion, and exercises that require equipment.
Choose the exact plan duration in whole months (at least 1, never shorter than one month of 30 days, and at most 12) based on case complexity. Return exactly one
phase object per plan month in chronological order, with a concise phase name and a patient-friendly
tagline that describes that month's progression. Also return exactly three simple, low-risk steps
with exerciseName, a lowercase snake_case animationTriggerId, realistic durationSeconds, voiceCue
containing the exact spoken instruction for text-to-speech, and movement.
${MOVEMENT_INSTRUCTIONS}
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
${describeEvidence(files)}
Triage quiz answers: ${JSON.stringify(quizAnswers)}
Synthesize the final baseline rehabilitation timeline from all available evidence.`,
            files,
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
  currentPlan: StoredTreatmentPlan,
  report: DiscomfortReport,
) {
  try {
    const abortSignal = createAiAbortSignal(AI_RESCHEDULE_TIMEOUT_MS);
    const { object } = await generateObject({
      model: getAiModel(),
      abortSignal,
      maxRetries: 0,
      schema: rescheduledScheduleSchema,
      system: `You are a clinical physiotherapist updating a rolling rehabilitation schedule after a patient
reported more discomfort following today's session. The patient named the exercises that caused it and
described the trigger.
Return the next 3 to 7 days with one unique entry per dayOffset. dayOffset 0 is today. Keep its
focus and tagline as in the current schedule and return an empty steps array for it, because today's
exercises are already done and are not changed. Rewrite every day with dayOffset 1 or higher (tomorrow
and each remaining day) so it avoids or modifies the aggravating movement.
For every day with dayOffset 1 or higher that is not a rest day, return a steps array of 1 to 5 simple,
low-risk exercises with exerciseName, a lowercase snake_case animationTriggerId, a realistic
durationSeconds, and a voiceCue containing the exact spoken instruction for text-to-speech, written as
one short sentence. Rest days return an empty steps array.
Rules for the steps:
- Never include a reported exercise under its original name. Either remove it, replace it with a
  gentler alternative, or keep a modified version with a new exerciseName that states the change,
  such as a smaller range, a slower tempo, or fewer seconds, chosen to avoid the trigger the patient
  described.
- Reuse the animationTriggerId of the original exercise only for a smaller-range version of that
  same movement. Otherwise use a new snake_case id.
- Do not require equipment, do not increase intensity, and add recovery time where sensible.
- The voiceCue of a modified exercise must tell the patient to stop if the described pain returns.
- Include a movement object for every exercise you add or change. You may leave movement out only
  for an exercise kept exactly as it is in the current plan, under the same exerciseName.
${MOVEMENT_INSTRUCTIONS}
Mark today active, later days upcoming, and recovery days rest. Keep each focus and tagline concise
and patient-friendly. Do not diagnose.${
        report.redFlag
          ? `
This was a red-flag stop: the patient pressed Pain Override for sharp pain or a sudden loss of movement.
Be markedly more conservative. Make tomorrow a rest or recovery day, remove every movement that loads
the reported regions, keep later days very gentle, and say in tomorrow's tagline that a clinician should
review the plan before progressing.`
          : ""
      }`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Symptoms: ${symptoms.trim()}
Date of the session: ${report.dateKey}
Exercises that caused discomfort: ${JSON.stringify(report.discomfortExercises)}
Patient description of the discomfort or trigger: ${JSON.stringify(report.discomfortDetails)}
${report.regions?.length ? `Reported body regions: ${JSON.stringify(report.regions)}\n` : ""}${report.notes ? `Additional notes: ${JSON.stringify(report.notes)}\n` : ""}Current treatment plan: ${JSON.stringify(currentPlan)}
Return the rewritten rolling schedule as safe JSON.`,
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
