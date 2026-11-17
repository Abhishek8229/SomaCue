import { createOpenAI } from "@ai-sdk/openai";

/**
 * Server-only. The OpenAI-compatible client pointed at OpenRouter (AI_BASE_URL)
 * shared by triage and plan generation.
 */
export const aiProvider = createOpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
});

/** Model used for chat replies. */
export const CHAT_MODEL = process.env.AI_CHAT_MODEL?.trim() || "nvidia/nemotron-3.5-super-vl:free";

/**
 * Adds OpenRouter's `reasoning: { enabled: false }` to chat requests. The chat
 * model is a reasoning model: its hidden thinking counts against max_tokens,
 * and with the patient context it used almost the whole 350-token ceiling,
 * leaving an empty answer. Short chat replies do not need it.
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

/** Client for the Rehab Companion chat: same account, reasoning switched off. */
export const chatProvider = createOpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
  fetch: noReasoningFetch,
});
