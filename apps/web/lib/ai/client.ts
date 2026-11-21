import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/*
 * Server-only. Every AI feature (triage, scan analysis, plan generation, rescheduling, report
 * extraction and the Rehab Companion) reads the same three settings from the environment:
 *
 *   AI_BASE_URL  the OpenAI-compatible endpoint, for example https://openrouter.ai/api/v1
 *   AI_API_KEY   the key for that endpoint
 *   AI_MODEL     the model slug to use
 *
 * Nothing in the code names a model or falls back to one. If any of the three is missing the
 * request fails with an AiConfigError that says which, instead of quietly using something else.
 * The settings are read when a request needs them, not when the module loads, so the build and
 * the pages that never call the AI do not need them.
 */

export type AiConfig = { baseURL: string; apiKey: string; model: string };

const REQUIRED = ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"] as const;

export class AiConfigError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`AI is not configured: set ${missing.join(", ")} in .env.`);
    this.name = "AiConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** The three settings, exactly as set in the environment. Throws AiConfigError naming any that are missing or blank. */
export function getAiConfig(env: Env = process.env): AiConfig {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new AiConfigError(missing);
  return {
    baseURL: (env.AI_BASE_URL as string).trim(),
    apiKey: (env.AI_API_KEY as string).trim(),
    model: (env.AI_MODEL as string).trim(),
  };
}

/** The model for triage, scan analysis, plan generation, rescheduling and report extraction. */
export function getAiModel(env: Env = process.env): LanguageModel {
  const config = getAiConfig(env);
  return createOpenAI({ baseURL: config.baseURL, apiKey: config.apiKey }).chat(config.model);
}

/**
 * Adds OpenRouter's `reasoning: { enabled: false }` to chat requests. A reasoning model's hidden
 * thinking counts against max_tokens, and with the patient context it can use almost the whole
 * 350-token ceiling, leaving an empty answer. Short chat replies do not need it.
 */
export const noReasoningFetch: typeof fetch = async (input, init) => {
  if (typeof init?.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (Array.isArray(body.messages)) {
        return fetch(input, { ...init, body: JSON.stringify({ ...body, reasoning: { enabled: false } }) });
      }
    } catch {
      // Not JSON: send unchanged.
    }
  }
  return fetch(input, init);
};

/** The same model and account for the Rehab Companion chat, with reasoning switched off. */
export function getChatModel(env: Env = process.env): LanguageModel {
  const config = getAiConfig(env);
  return createOpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, fetch: noReasoningFetch }).chat(config.model);
}
