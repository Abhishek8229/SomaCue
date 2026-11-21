import { z } from "zod";
import { REGIONS, type Region } from "@/lib/kinematics/vocabulary";
import { FEEDBACK_TEXT_MAX } from "./dailyProgress";

/** Pure schema and helpers for the Pain Override report. Shared by client and server. */

export const PAIN_TYPES = ["sharp_pain", "movement_loss", "other"] as const;
export type PainType = (typeof PAIN_TYPES)[number];

export const PAIN_TYPE_LABELS: Record<PainType, string> = {
  sharp_pain: "Sharp pain",
  movement_loss: "Sudden loss of movement",
  other: "Something else",
};

export const painContextSchema = z.object({
  exerciseName: z.string().max(200).nullable(),
  rep: z.number().int().min(0).max(100).nullable(),
  set: z.number().int().min(0).max(10).nullable(),
  phase: z.string().max(40).nullable(),
  elapsedSeconds: z.number().min(0).max(36_000).nullable(),
});
export type PainContext = z.infer<typeof painContextSchema>;

export const painReportSchema = z.object({
  exerciseNames: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  painType: z.enum(PAIN_TYPES),
  regions: z.array(z.enum(REGIONS)).min(1).max(REGIONS.length),
  details: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX),
  context: painContextSchema,
});
export type PainReport = z.infer<typeof painReportSchema>;

export type PainReportDraft = {
  exerciseNames: string[];
  painType: PainType | null;
  regions: Region[];
  details: string;
};

export function validatePainDraft(draft: PainReportDraft) {
  const errors: Partial<Record<keyof PainReportDraft, string>> = {};
  if (draft.exerciseNames.length === 0) errors.exerciseNames = "Choose the exercise you were doing.";
  if (!draft.painType) errors.painType = "Choose what happened.";
  if (draft.regions.length === 0) errors.regions = "Choose where you felt it.";
  const details = draft.details.trim();
  if (!details) errors.details = "Describe what happened in your own words.";
  else if (details.length > FEEDBACK_TEXT_MAX) errors.details = `Keep this under ${FEEDBACK_TEXT_MAX} characters.`;
  return { valid: Object.keys(errors).length === 0, errors };
}

export type ReportPainResult =
  | {
      success: true;
      eventId: string;
      /** Set when this stop showed the case needs in-person care. */
      escalation?: import("@/lib/clinical/assessment").Escalation | null;
    }
  | { success: false; error: string };

export type ReschedulePainResult =
  | { success: true; schedule: import("./dailyProgress").ScheduleWithSteps }
  | {
      success: false;
      error: string;
      aiError?: "AI_PROVIDER_FAILED" | "AI_PROVIDER_TIMEOUT";
    };
