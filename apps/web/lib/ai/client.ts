import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createGeminiFetch, GEMINI_API_BASE, isGeminiConfig } from "./gemini";

/*
 * Server-only. Every AI feature (triage, scan analysis, plan generation, rescheduling, report
 * extraction and the Rehab Companion) reads the same three settings from the environment:
 *
 *   AI_BASE_URL  the endpoint, for example https://openrouter.ai/api/v1 (OpenAI-compatible)
 *   AI_API_KEY   the key for that endpoint
 *   AI_MODEL     the model slug to use
 *
 * Gemini is the one provider with its own path. When AI_BASE_URL contains generativelanguage.googleapis.com, or
 * AI_API_KEY starts with "AQ.", requests go to Gemini's native v1beta API (see gemini.ts) with an x-goog-api-key
 * header, not to /v1beta/openai/chat/completions. Everything else keeps the OpenAI-compatible client.
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

/**
 * The model for triage, scan analysis, plan generation, rescheduling and report extraction.
 * A Gemini setup uses Gemini's native API (see gemini.ts); every other provider uses the OpenAI-compatible client.
 */
export function getAiModel(env: Env = process.env): LanguageModel {
  const config = getAiConfig(env);
  if (isGeminiConfig(config)) return geminiChatModel(config);
  return createOpenAI({ baseURL: config.baseURL, apiKey: config.apiKey }).chat(config.model);
}

/**
 * The same OpenAI chat provider, with its network calls handled by the Gemini adapter. The provider needs a base URL
 * and a key to be built, but the adapter sends its own request (`x-goog-api-key`, native endpoint), so the provider's
 * `Authorization: Bearer` header never reaches Google.
 */
function geminiChatModel(config: AiConfig): LanguageModel {
  return createOpenAI({
    baseURL: GEMINI_API_BASE,
    apiKey: config.apiKey,
    fetch: createGeminiFetch({ apiKey: config.apiKey, model: config.model }),
  }).chat(config.model);
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

/** Gemini's thinking tokens count against the output limit, so the chat reply limit is raised for it (see gemini.ts). */
export const GEMINI_CHAT_MAX_OUTPUT_TOKENS = 1200;

/**
 * The reply limit for one Rehab Companion message: `base` for every provider except Gemini, which gets
 * {@link GEMINI_CHAT_MAX_OUTPUT_TOKENS} (never less than `base`).
 */
export function chatMaxOutputTokens(base: number, env: Env = process.env): number {
  return isGeminiConfig(getAiConfig(env)) ? Math.max(base, GEMINI_CHAT_MAX_OUTPUT_TOKENS) : base;
}

/**
 * The same model and account for the Rehab Companion chat. On OpenRouter-style providers reasoning is switched off; the
 * Gemini adapter asks for low thinking instead (`thinkingLevel`, not `thinkingBudget`, which Gemini 4 models reject).
 */
export function getChatModel(env: Env = process.env): LanguageModel {
  const config = getAiConfig(env);
  if (isGeminiConfig(config)) return geminiChatModel(config);
  return createOpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, fetch: noReasoningFetch }).chat(config.model);
}
