/*
 * Server-only. Talks to Google's Gemini through its native v1beta REST API instead of the OpenAI-compatible
 * endpoint (`/v1beta/openai/chat/completions`).
 *
 * SomaCue's AI features all go through the Vercel AI SDK's OpenAI chat provider (see client.ts). This module is a
 * `fetch` that sits under that provider. It receives the provider's OpenAI chat-completions request, turns it into a
 * Gemini `GenerateContentRequest`, calls `generateContent` (or `streamGenerateContent?alt=sse`), and turns the answer
 * back into an OpenAI chat completion (or an OpenAI SSE stream). The callers (`generateObject`, `streamText`) are
 * unchanged, and every other provider keeps using the plain OpenAI-compatible client.
 *
 * Authentication is `x-goog-api-key`. No `Authorization: Bearer` header is sent: AQ. keys are not bearer tokens.
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const GEMINI_HOST = "generativelanguage.googleapis.com";

/**
 * Gemini 4 models think at a "high" level unless told otherwise, and that thinking counts against `maxOutputTokens`:
 * with a small limit the answer can be left empty. Every request asks for "low". `thinkingBudget` is not used, because
 * Gemini 4 models do not support it.
 */
export const GEMINI_THINKING_LEVEL = "low";

/** True for a Gemini setup: the base URL names Google's host, or the key is an AQ. key. */
export function isGeminiConfig(config: { baseURL: string; apiKey: string }): boolean {
  return config.baseURL.toLowerCase().includes(GEMINI_HOST) || config.apiKey.startsWith("AQ.");
}

/** The model id Gemini's URL needs: no leading `models/` or `google/` (the slug other providers use). */
export function geminiModelId(model: string): string {
  return model.trim().replace(/^(?:models\/|google\/)+/i, "");
}

export function geminiEndpoint(model: string, stream: boolean): string {
  const id = encodeURIComponent(geminiModelId(model));
  return stream ? `${GEMINI_API_BASE}/models/${id}:streamGenerateContent?alt=sse` : `${GEMINI_API_BASE}/models/${id}:generateContent`;
}

/* ------------------------------------------------------------------------------------------ request mapping */

type Json = Record<string, unknown>;
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type GeminiRequest = {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
  generationConfig?: Json;
};

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** `data:image/png;base64,AAAA` as Gemini's inline data, or null when it is not a data URL. */
function inlineDataOf(url: string): GeminiPart | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  return match ? { inlineData: { mimeType: match[1], data: match[2] } } : null;
}

/** The parts of one OpenAI message `content`: a string, or a list of text, image_url and file parts. */
function partsOf(content: unknown): GeminiPart[] {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  const parts: GeminiPart[] = [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string") {
      if (item.text) parts.push({ text: item.text });
    } else if (item.type === "image_url" && isRecord(item.image_url) && typeof item.image_url.url === "string") {
      // Gemini cannot fetch arbitrary URLs, so only inline (data URL) images are sent.
      const inline = inlineDataOf(item.image_url.url);
      if (inline) parts.push(inline);
    } else if (item.type === "file" && isRecord(item.file) && typeof item.file.file_data === "string") {
      const inline = inlineDataOf(item.file.file_data);
      if (inline) parts.push(inline);
    }
  }
  return parts;
}

function textOfParts(parts: GeminiPart[]): string {
  return parts.map((part) => ("text" in part ? part.text : "")).filter(Boolean).join("\n\n");
}

/** Keywords Gemini's JSON-schema support does not take; anything else in the schema is passed through. */
const DROPPED_SCHEMA_KEYS = new Set(["$schema", "strict"]);

function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!isRecord(schema)) return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => !DROPPED_SCHEMA_KEYS.has(key)).map(([key, value]) => [key, cleanSchema(value)]));
}

/** OpenAI chat-completions request body -> Gemini GenerateContentRequest. */
export function toGeminiRequest(body: Json): GeminiRequest {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    if (!isRecord(message)) continue;
    const parts = partsOf(message.content);
    if (message.role === "system" || message.role === "developer") {
      const text = textOfParts(parts);
      if (text) systemTexts.push(text);
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (parts.length === 0) continue;
    const role = message.role === "assistant" ? "model" : "user";
    // Adjacent turns by the same role are one turn, so the conversation alternates cleanly.
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  }

  const request: GeminiRequest = { contents };
  if (systemTexts.length > 0) request.systemInstruction = { parts: [{ text: systemTexts.join("\n\n") }] };

  const generationConfig: Json = { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL } };
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : body.max_completion_tokens;
  if (typeof maxTokens === "number") generationConfig.maxOutputTokens = maxTokens;
  if (typeof body.top_p === "number") generationConfig.topP = body.top_p;
  const stop = typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? body.stop.filter((item) => typeof item === "string") : [];
  if (stop.length > 0) generationConfig.stopSequences = stop;

  const format = isRecord(body.response_format) ? body.response_format : null;
  if (format?.type === "json_object") {
    generationConfig.responseMimeType = "application/json";
  } else if (format?.type === "json_schema") {
    // `generateObject` asks for a JSON schema. JSON mode plus the schema keeps the answer parseable and on shape.
    generationConfig.responseMimeType = "application/json";
    const schema = isRecord(format.json_schema) ? format.json_schema.schema : undefined;
    if (isRecord(schema)) generationConfig.responseJsonSchema = cleanSchema(schema);
  }
  request.generationConfig = generationConfig;
  return request;
}

/* ----------------------------------------------------------------------------------------- response mapping */

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number; completion_tokens_details?: { reasoning_tokens: number } };

/** The visible text of a candidate: every text part except the model's own thoughts. */
export function geminiTextOf(candidate: unknown): string {
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return "";
  return candidate.content.parts
    .filter((part): part is Json & { text: string } => isRecord(part) && typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text)
    .join("");
}

const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"]);

export function openAiFinishReason(finishReason: unknown, blockReason?: unknown): string {
  if (typeof blockReason === "string" && blockReason) return "content_filter";
  if (typeof finishReason !== "string" || !finishReason) return "stop";
  if (finishReason === "MAX_TOKENS") return "length";
  if (BLOCKED.has(finishReason)) return "content_filter";
  return "stop";
}

function usageOf(metadata: unknown): Usage | undefined {
  if (!isRecord(metadata)) return undefined;
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const prompt = num(metadata.promptTokenCount);
  const thoughts = num(metadata.thoughtsTokenCount);
  const completion = num(metadata.candidatesTokenCount) + thoughts;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: num(metadata.totalTokenCount) || prompt + completion,
    ...(thoughts > 0 ? { completion_tokens_details: { reasoning_tokens: thoughts } } : {}),
  };
}

let counter = 0;
const newId = () => `chatcmpl-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** A Gemini `generateContent` answer as an OpenAI chat completion. */
export function toOpenAiCompletion(response: unknown, model: string): Json {
  const data = isRecord(response) ? response : {};
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
  const blockReason = isRecord(data.promptFeedback) ? data.promptFeedback.blockReason : undefined;
  const finishReason = isRecord(candidate) ? candidate.finishReason : undefined;
  return {
    id: newId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: geminiTextOf(candidate) },
        finish_reason: openAiFinishReason(finishReason, blockReason),
      },
    ],
    ...(usageOf(data.usageMetadata) ? { usage: usageOf(data.usageMetadata) } : {}),
  };
}

/* --------------------------------------------------------------------------------------------- streaming */

const encoder = new TextEncoder();
const sse = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

/**
 * Gemini's `?alt=sse` stream as OpenAI chat-completion chunks. Each Gemini `data:` event carries the next piece of
 * text (not the text so far), so each becomes one `delta.content` chunk. The stream ends with a chunk that has the
 * finish reason, an optional usage chunk, and `[DONE]`: the AI SDK treats a stream without a finish reason as cut off.
 */
export function geminiStreamToOpenAi(upstream: ReadableStream<Uint8Array>, model: string, includeUsage: boolean): ReadableStream<Uint8Array> {
  const id = newId();
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta: Json, finishReason: string | null) => ({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] });

  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  let finishReason: unknown;
  let blockReason: unknown;
  let usage: Usage | undefined;

  const handleEvent = (event: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // a partial or non-JSON line: nothing to emit
    }
    if (!isRecord(parsed)) return;
    if (isRecord(parsed.error)) {
      controller.enqueue(sse({ error: { message: String(parsed.error.message ?? "Gemini request failed"), type: "api_error", code: parsed.error.code ?? null } }));
      return;
    }
    if (!started) {
      started = true;
      controller.enqueue(sse(chunk({ role: "assistant", content: "" }, null)));
    }
    const candidate = Array.isArray(parsed.candidates) ? parsed.candidates[0] : undefined;
    const text = geminiTextOf(candidate);
    if (text) controller.enqueue(sse(chunk({ content: text }, null)));
    if (isRecord(candidate) && candidate.finishReason) finishReason = candidate.finishReason;
    if (isRecord(parsed.promptFeedback) && parsed.promptFeedback.blockReason) blockReason = parsed.promptFeedback.blockReason;
    if (parsed.usageMetadata) usage = usageOf(parsed.usageMetadata);
  };

  const drain = (controller: TransformStreamDefaultController<Uint8Array>, final: boolean) => {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffer);
      if (!boundary) break;
      handleEvent(buffer.slice(0, boundary.index), controller);
      buffer = buffer.slice(boundary.index + boundary[0].length);
    }
    if (final && buffer.trim()) {
      handleEvent(buffer, controller);
      buffer = "";
    }
  };

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true });
        drain(controller, false);
      },
      flush(controller) {
        buffer += decoder.decode();
        drain(controller, true);
        if (!started) controller.enqueue(sse(chunk({ role: "assistant", content: "" }, null)));
        controller.enqueue(sse(chunk({}, openAiFinishReason(finishReason, blockReason))));
        if (includeUsage && usage) controller.enqueue(sse({ id, object: "chat.completion.chunk", created, model, choices: [], usage }));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}

/* ----------------------------------------------------------------------------------------------- the fetch */

export type GeminiFetchOptions = { apiKey: string; model: string; fetch?: typeof fetch };

/**
 * A `fetch` for the OpenAI chat provider: chat-completions calls go to Gemini's native API and come back in OpenAI's
 * shape. Gemini errors keep their status and their `{ error: { message } }` body, which is the shape the SDK reads.
 */
export function createGeminiFetch(options: GeminiFetchOptions): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const send = options.fetch ?? fetch;
    if (!/\/chat\/completions(?:\?|$)/.test(url) || typeof init?.body !== "string") return send(input, init);

    const body = JSON.parse(init.body) as Json;
    const model = typeof body.model === "string" && body.model ? body.model : options.model;
    const stream = body.stream === true;
    const includeUsage = isRecord(body.stream_options) && body.stream_options.include_usage === true;

    const upstream = await send(geminiEndpoint(model, stream), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": options.apiKey },
      body: JSON.stringify(toGeminiRequest(body)),
      signal: init.signal,
    });
    if (!upstream.ok) return upstream;

    if (stream && upstream.body) {
      return new Response(geminiStreamToOpenAi(upstream.body, geminiModelId(model), includeUsage), {
        status: 200,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }
    const completion = toOpenAiCompletion(await upstream.json(), geminiModelId(model));
    return new Response(JSON.stringify(completion), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}
