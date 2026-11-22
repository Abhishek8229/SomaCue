import { generateObject } from "ai";
import { z } from "zod";
import { getAiModel } from "@/lib/ai/client";
import type { ClinicalDiagnosis } from "@/lib/safety/engine";

const REGIONS = ["cervical", "thoracic", "lumbar", "sacral"] as const;
const LEVELS = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7",
  "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12",
  "L1", "L2", "L3", "L4", "L5",
  "S1", "S2", "S3", "S4", "S5",
] as const;
const PATHOLOGIES = ["herniation", "bulge", "stenosis", "sprain"] as const;

/** Exactly these three fields, each from a fixed list: anything else is rejected, not repaired. */
const diagnosisSchema = z
  .object({
    region: z.enum(REGIONS),
    level: z.enum(LEVELS),
    pathology: z.enum(PATHOLOGIES),
  })
  .strict();

const SYSTEM_PROMPT = `You are a structured clinical data extraction service, not a diagnostic physician.
Read the supplied MRI or clinical report and extract only findings explicitly supported by the text.
Do not infer, speculate, diagnose, recommend treatment, or add explanatory prose.
Return exactly one JSON object with region, level, and pathology.
Use lowercase values exactly as permitted by the response schema.
If the report does not clearly support a required field, do not invent a value; the request must fail validation.
The output is consumed by a deterministic safety engine, so strict schema compliance is mandatory.`;

const EXTRACTION_TIMEOUT_MS = 60_000;

/** Uses the model named by AI_MODEL, through AI_BASE_URL and AI_API_KEY: the same settings as every other AI feature. */
export async function extractClinicalDiagnosis(reportText: string): Promise<ClinicalDiagnosis> {
  const report = reportText.trim();
  if (!report) throw new Error("Report text is required");

  const { object } = await generateObject({
    model: getAiModel(),
    abortSignal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
    maxRetries: 0,
    schema: diagnosisSchema,
    system: SYSTEM_PROMPT,
    prompt: report,
  });

  return object;
}
