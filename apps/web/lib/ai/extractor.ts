import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { GenerativeModel } from "@google/generative-ai";
import type { ClinicalDiagnosis } from "@/lib/safety/engine";

let model: GenerativeModel | null = null;

function getModel(): GenerativeModel {
  if (model) return model;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
  model: "gemini-2.5-flash",
  systemInstruction: {
    role: "system",
    parts: [
      {
        text: `You are a structured clinical data extraction service, not a diagnostic physician.
Read the supplied MRI or clinical report and extract only findings explicitly supported by the text.
Do not infer, speculate, diagnose, recommend treatment, or add explanatory prose.
Return exactly one JSON object with region, level, and pathology.
Use lowercase values exactly as permitted by the response schema.
If the report does not clearly support a required field, do not invent a value; the request must fail validation.
The output is consumed by a deterministic safety engine, so strict schema compliance is mandatory.`,
      },
    ],
  },
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: SchemaType.OBJECT,
      properties: {
        region: {
          type: SchemaType.STRING,
          format: "enum",
          enum: ["cervical", "thoracic", "lumbar", "sacral"],
        },
        level: {
          type: SchemaType.STRING,
          format: "enum",
          enum: [
            "C1",
            "C2",
            "C3",
            "C4",
            "C5",
            "C6",
            "C7",
            "T1",
            "T2",
            "T3",
            "T4",
            "T5",
            "T6",
            "T7",
            "T8",
            "T9",
            "T10",
            "T11",
            "T12",
            "L1",
            "L2",
            "L3",
            "L4",
            "L5",
            "S1",
            "S2",
            "S3",
            "S4",
            "S5",
          ],
        },
        pathology: {
          type: SchemaType.STRING,
          format: "enum",
          enum: ["herniation", "bulge", "stenosis", "sprain"],
        },
      },
      required: ["region", "level", "pathology"],
    },
  },
  });
  return model;
}

const REGIONS = ["cervical", "thoracic", "lumbar", "sacral"] as const;
const LEVELS = [
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
  "T10",
  "T11",
  "T12",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
  "S1",
  "S2",
  "S3",
  "S4",
  "S5",
] as const;
const PATHOLOGIES = ["herniation", "bulge", "stenosis", "sprain"] as const;

function isClinicalDiagnosis(value: unknown): value is ClinicalDiagnosis {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const diagnosis = value as Record<string, unknown>;
  return (
    Object.keys(diagnosis).length === 3 &&
    typeof diagnosis.region === "string" &&
    REGIONS.includes(diagnosis.region as (typeof REGIONS)[number]) &&
    typeof diagnosis.level === "string" &&
    LEVELS.includes(diagnosis.level as (typeof LEVELS)[number]) &&
    typeof diagnosis.pathology === "string" &&
    PATHOLOGIES.includes(diagnosis.pathology as (typeof PATHOLOGIES)[number])
  );
}

export async function extractClinicalDiagnosis(
  reportText: string,
): Promise<ClinicalDiagnosis> {
  const report = reportText.trim();
  if (!report) throw new Error("Report text is required");

  const result = await getModel().generateContent(report);
  const rawText = result.response.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }

  if (!isClinicalDiagnosis(parsed)) {
    throw new Error("Gemini returned an invalid clinical diagnosis");
  }

  return parsed;
}
