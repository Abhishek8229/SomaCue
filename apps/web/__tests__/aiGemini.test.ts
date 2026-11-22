// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateObject, generateText, streamText } from "ai";
import { z } from "zod";
import { chatMaxOutputTokens, GEMINI_CHAT_MAX_OUTPUT_TOKENS, getAiModel, getChatModel } from "@/lib/ai/client";
import {
  createGeminiFetch,
  GEMINI_THINKING_LEVEL,
  geminiEndpoint,
  geminiModelId,
  geminiStreamToOpenAi,
  isGeminiConfig,
  toGeminiRequest,
  toOpenAiCompletion,
} from "@/lib/ai/gemini";

const GEMINI_ENV = {
  AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  AI_API_KEY: "AQ.test-key-123",
  AI_MODEL: "google/gemini-4-hydrogen",
};
const OPENAI_ENV = { AI_BASE_URL: "https://ai.example.test/v1", AI_API_KEY: "sk-test-123", AI_MODEL: "vendor/some-model" };

const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
  usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5, totalTokenCount: 16 },
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A Gemini `?alt=sse` body, cut into small byte pieces so events arrive split across reads. */
function geminiSse(events: unknown[], pieceSize = 9, lineEnd = "\r\n") {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}${lineEnd}${lineEnd}`).join(""));
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + pieceSize));
      offset += pieceSize;
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out + decoder.decode();
    out += decoder.decode(value, { stream: true });
  }
}

/** The OpenAI SSE a Gemini stream turns into, as parsed events (the `[DONE]` marker as the string "[DONE]"). */
async function openAiEvents(stream: ReadableStream<Uint8Array>) {
  return (await readAll(stream))
    .split("\n\n")
    .filter(Boolean)
    .map((event) => event.replace(/^data: /, ""))
    .map((data) => (data === "[DONE]" ? data : JSON.parse(data)));
}

type Call = { url: string; headers: Headers; body: Record<string, unknown> | null };
function stubFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("choosing Gemini's native API", () => {
  it("is used when the base URL names Google's host, whatever the key looks like", () => {
    expect(isGeminiConfig({ baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "AIzaSyExample" })).toBe(true);
    expect(isGeminiConfig({ baseURL: "https://GenerativeLanguage.GoogleAPIs.com/v1beta", apiKey: "x" })).toBe(true);
  });

  it("is used for an AQ. key even when the base URL is something else", () => {
    expect(isGeminiConfig({ baseURL: "https://proxy.example.test/v1", apiKey: "AQ.abc" })).toBe(true);
  });

  it("is not used for other providers", () => {
    expect(isGeminiConfig({ baseURL: "https://openrouter.ai/api/v1", apiKey: "sk-or-v1-abc" })).toBe(false);
    expect(isGeminiConfig({ baseURL: "https://ai.example.test/v1", apiKey: "aq.lowercase-is-not-it" })).toBe(false);
  });
});

describe("model id and endpoints", () => {
  it("strips accidental models/ and google/ prefixes", () => {
    expect(geminiModelId("gemini-4-hydrogen")).toBe("gemini-4-hydrogen");
    expect(geminiModelId("google/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(geminiModelId("models/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(geminiModelId(" models/google/gemini-2.5-flash ")).toBe("gemini-2.5-flash");
  });

  it("uses generateContent for a normal call and streamGenerateContent with alt=sse for a stream", () => {
    expect(geminiEndpoint("google/gemini-4-hydrogen", false)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
    expect(geminiEndpoint("models/gemini-4-hydrogen", true)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:streamGenerateContent?alt=sse",
    );
  });
});

describe("request mapping: OpenAI messages to a Gemini GenerateContentRequest", () => {
  it("moves system messages into systemInstruction and maps user and assistant to user and model", () => {
    const request = toGeminiRequest({
      messages: [
        { role: "system", content: "You are a physiotherapy assistant." },
        { role: "developer", content: "Be brief." },
        { role: "user", content: "My knee hurts." },
        { role: "assistant", content: "Where exactly?" },
        { role: "user", content: "Behind the kneecap." },
      ],
    });
    expect(request.systemInstruction).toEqual({ parts: [{ text: "You are a physiotherapy assistant.\n\nBe brief." }] });
    expect(request.contents).toEqual([
      { role: "user", parts: [{ text: "My knee hurts." }] },
      { role: "model", parts: [{ text: "Where exactly?" }] },
      { role: "user", parts: [{ text: "Behind the kneecap." }] },
    ]);
  });

  it("merges adjacent messages with the same role so the turns alternate", () => {
    const request = toGeminiRequest({
      messages: [
        { role: "user", content: "First." },
        { role: "user", content: [{ type: "text", text: "Second." }] },
        { role: "assistant", content: "Reply one." },
        { role: "assistant", content: "Reply two." },
        { role: "user", content: "Third." },
      ],
    });
    expect(request.contents.map((turn) => turn.role)).toEqual(["user", "model", "user"]);
    expect(request.contents[0].parts).toEqual([{ text: "First." }, { text: "Second." }]);
    expect(request.contents[1].parts).toEqual([{ text: "Reply one." }, { text: "Reply two." }]);
  });

  it("maps temperature and max_tokens, and also top_p and stop", () => {
    const request = toGeminiRequest({ messages: [{ role: "user", content: "Hi" }], temperature: 0.3, max_tokens: 350, top_p: 0.9, stop: "END" });
    expect(request.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "low" }, temperature: 0.3, maxOutputTokens: 350, topP: 0.9, stopSequences: ["END"] });
  });

  it("asks for JSON for response_format json_object", () => {
    const request = toGeminiRequest({ messages: [{ role: "user", content: "Hi" }], response_format: { type: "json_object" } });
    expect(request.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json" });
  });

  it("asks for JSON and passes the schema for json_schema, which is what generateObject sends", () => {
    const request = toGeminiRequest({
      messages: [{ role: "user", content: "Hi" }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "response", strict: true, schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } },
      },
    });
    expect(request.generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: "low" },
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
    });
  });

  it("asks for low thinking on every request, and never sends thinkingBudget", () => {
    const plain = toGeminiRequest({ messages: [{ role: "user", content: "Hi" }] });
    expect(plain.generationConfig).toEqual({ thinkingConfig: { thinkingLevel: "low" } });
    expect(GEMINI_THINKING_LEVEL).toBe("low");

    const withEverything = toGeminiRequest({
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0,
      max_tokens: 10,
      reasoning: { enabled: false },
      reasoning_effort: "high",
      response_format: { type: "json_object" },
    });
    // the OpenAI-style reasoning fields are not passed on, and the level stays low
    expect(withEverything.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "low" }, temperature: 0, maxOutputTokens: 10 });
    expect(JSON.stringify(withEverything)).not.toMatch(/thinkingBudget|reasoning/i);
  });

  it("sends inline images and PDFs from data URLs, and leaves out URLs Gemini cannot fetch", () => {
    const request = toGeminiRequest({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Scans follow." },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            { type: "image_url", image_url: { url: "https://example.test/scan.png" } },
            { type: "file", file: { filename: "note.pdf", file_data: "data:application/pdf;base64,BBBB" } },
          ],
        },
      ],
    });
    expect(request.contents[0].parts).toEqual([
      { text: "Scans follow." },
      { inlineData: { mimeType: "image/png", data: "AAAA" } },
      { inlineData: { mimeType: "application/pdf", data: "BBBB" } },
    ]);
  });

  it("skips empty messages", () => {
    const request = toGeminiRequest({ messages: [{ role: "user", content: "" }, { role: "user", content: "Real." }] });
    expect(request.contents).toEqual([{ role: "user", parts: [{ text: "Real." }] }]);
  });
});

describe("the Gemini fetch: non-streaming", () => {
  const options = { apiKey: "AQ.test-key-123", model: "google/gemini-4-hydrogen" };
  const openAiBody = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ model: "google/gemini-4-hydrogen", messages: [{ role: "system", content: "Be kind." }, { role: "user", content: "Hello" }], temperature: 0.2, max_tokens: 100, ...extra });

  it("posts to generateContent with x-goog-api-key and no Authorization header", async () => {
    const calls = stubFetch(() => json(reply("Hi there")));
    const response = await createGeminiFetch(options)("https://generativelanguage.googleapis.com/v1beta/chat/completions", { method: "POST", headers: { Authorization: "Bearer AQ.test-key-123" }, body: openAiBody() });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
    expect(calls[0].headers.get("x-goog-api-key")).toBe("AQ.test-key-123");
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].headers.has("authorization")).toBe(false);
    expect(calls[0].body).toEqual({
      systemInstruction: { parts: [{ text: "Be kind." }] },
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: "low" }, temperature: 0.2, maxOutputTokens: 100 },
    });
    expect(response.status).toBe(200);
  });

  it("answers as an OpenAI chat completion with the text, finish reason and usage", async () => {
    stubFetch(() => json(reply("Hi there")));
    const response = await createGeminiFetch(options)("https://x.test/v1/chat/completions", { method: "POST", body: openAiBody() });
    expect(await response.json()).toMatchObject({
      object: "chat.completion",
      model: "gemini-4-hydrogen",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi there" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
    });
  });

  it("ignores thought parts and joins the visible text", () => {
    const completion = toOpenAiCompletion(
      {
        candidates: [{ content: { parts: [{ text: "Let me think...", thought: true }, { text: "Answer " }, { text: "part two." }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 6, totalTokenCount: 13 },
      },
      "gemini-4-hydrogen",
    ) as { choices: Array<{ message: { content: string } }>; usage: { completion_tokens: number; completion_tokens_details?: { reasoning_tokens: number } } };
    expect(completion.choices[0].message.content).toBe("Answer part two.");
    expect(completion.usage).toMatchObject({ completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 6 } });
  });

  it("maps finish reasons: length for MAX_TOKENS, content_filter for safety blocks", () => {
    const finish = (response: unknown) => (toOpenAiCompletion(response, "m") as { choices: Array<{ finish_reason: string }> }).choices[0].finish_reason;
    expect(finish({ candidates: [{ content: { parts: [{ text: "cut" }] }, finishReason: "MAX_TOKENS" }] })).toBe("length");
    expect(finish({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })).toBe("content_filter");
    expect(finish({ promptFeedback: { blockReason: "SAFETY" } })).toBe("content_filter");
    expect(finish({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })).toBe("stop");
  });

  it("returns an empty answer, not an error, when the model produced no visible text", async () => {
    stubFetch(() => json({ candidates: [{ finishReason: "MAX_TOKENS" }] }));
    const response = await createGeminiFetch(options)("https://x.test/v1/chat/completions", { method: "POST", body: openAiBody() });
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: "" }, finish_reason: "length" }] });
  });

  it("passes a Gemini error through with its status and message", async () => {
    stubFetch(() => json({ error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT" } }, 400));
    const response = await createGeminiFetch(options)("https://x.test/v1/chat/completions", { method: "POST", body: openAiBody() });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { message: "API key not valid." } });
  });

  it("leaves calls that are not chat completions alone", async () => {
    const calls = stubFetch(() => json({ ok: true }));
    await createGeminiFetch(options)("https://x.test/v1/models", { method: "GET" });
    expect(calls[0].url).toBe("https://x.test/v1/models");
    expect(calls[0].headers.has("x-goog-api-key")).toBe(false);
  });
});

describe("the Gemini fetch: streaming (?alt=sse)", () => {
  const options = { apiKey: "AQ.test-key-123", model: "gemini-4-hydrogen" };
  const streamBody = (extra: Record<string, unknown> = {}) => JSON.stringify({ model: "gemini-4-hydrogen", stream: true, messages: [{ role: "user", content: "Hello" }], ...extra });
  const chunks = [
    reply("Hel", { usageMetadata: undefined, candidates: [{ content: { parts: [{ text: "Hel" }] } }] }),
    { candidates: [{ content: { parts: [{ text: "pondering", thought: true }, { text: "lo, " }] } }] },
    { candidates: [{ content: { parts: [{ text: "there!" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 } },
  ];

  it("posts to streamGenerateContent?alt=sse with the same headers", async () => {
    const calls = stubFetch(() => new Response(geminiSse(chunks), { headers: { "Content-Type": "text/event-stream" } }));
    await createGeminiFetch(options)("https://x.test/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer AQ.test-key-123" }, body: streamBody() });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:streamGenerateContent?alt=sse");
    expect(calls[0].headers.get("x-goog-api-key")).toBe("AQ.test-key-123");
    expect(calls[0].headers.has("authorization")).toBe(false);
  });

  it("turns each Gemini chunk into one OpenAI delta, in order, then the finish chunk and [DONE]", async () => {
    stubFetch(() => new Response(geminiSse(chunks), { headers: { "Content-Type": "text/event-stream" } }));
    const response = await createGeminiFetch(options)("https://x.test/v1/chat/completions", { method: "POST", body: streamBody() });
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const events = await openAiEvents(response.body!);
    const deltas = events.filter((event) => event !== "[DONE]").map((event) => event.choices[0]?.delta?.content).filter(Boolean);
    expect(deltas).toEqual(["Hel", "lo, ", "there!"]);
    expect(events[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(events.at(-1)).toBe("[DONE]");
    const last = events.at(-2);
    expect(last.choices[0]).toMatchObject({ delta: {}, finish_reason: "stop" });
    expect(events.every((event) => event === "[DONE]" || event.object === "chat.completion.chunk")).toBe(true);
  });

  it("adds a usage chunk only when the caller asked for it", async () => {
    const run = async (includeUsage: boolean) => (await openAiEvents(geminiStreamToOpenAi(geminiSse(chunks, 13), "gemini-4-hydrogen", includeUsage))).filter((event) => event !== "[DONE]");
    expect((await run(false)).some((event) => event.usage)).toBe(false);
    const withUsage = await run(true);
    expect(withUsage.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } });
  });

  it("copes with events split across reads and with plain \\n line endings", async () => {
    for (const [size, lineEnd] of [[1, "\r\n"], [5, "\n"], [4096, "\n"]] as const) {
      const events = await openAiEvents(geminiStreamToOpenAi(geminiSse(chunks, size, lineEnd), "m", false));
      const text = events.filter((event) => event !== "[DONE]").map((event) => event.choices[0]?.delta?.content ?? "").join("");
      expect(text, `piece ${size}`).toBe("Hello, there!");
    }
  });

  it("ends with a length finish reason when the answer was cut off", async () => {
    const cut = [{ candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason: "MAX_TOKENS" }] }];
    const events = await openAiEvents(geminiStreamToOpenAi(geminiSse(cut), "m", false));
    expect(events.at(-2).choices[0].finish_reason).toBe("length");
  });

  it("still finishes cleanly if Gemini sent nothing", async () => {
    const events = await openAiEvents(geminiStreamToOpenAi(geminiSse([]), "m", false));
    expect(events.at(-1)).toBe("[DONE]");
    expect(events.at(-2).choices[0].finish_reason).toBe("stop");
  });

  it("forwards an error event in the shape the SDK reads", async () => {
    const events = await openAiEvents(geminiStreamToOpenAi(geminiSse([{ error: { code: 503, message: "The model is overloaded." } }]), "m", false));
    expect(events[0]).toMatchObject({ error: { message: "The model is overloaded.", type: "api_error" } });
  });
});

describe("through the AI SDK, the way SomaCue calls it", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));

  it("streams the Rehab Companion's text in order from Gemini's native stream", async () => {
    const calls = stubFetch(() => new Response(geminiSse([{ candidates: [{ content: { parts: [{ text: "Keep " }] } }] }, { candidates: [{ content: { parts: [{ text: "it gentle." }] }, finishReason: "STOP" }] }]), { headers: { "Content-Type": "text/event-stream" } }));
    const result = streamText({
      model: getChatModel(GEMINI_ENV),
      system: "You are the Rehab Companion.",
      messages: [{ role: "user", content: "How hard should I push?" }],
      maxOutputTokens: 350,
      temperature: 0.3,
      maxRetries: 0,
    });
    const pieces: string[] = [];
    for await (const piece of result.textStream) pieces.push(piece);
    expect(pieces.join("")).toBe("Keep it gentle.");
    expect(pieces.length).toBeGreaterThanOrEqual(2);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:streamGenerateContent?alt=sse");
    expect(calls[0].headers.get("x-goog-api-key")).toBe("AQ.test-key-123");
    expect(calls[0].headers.has("authorization")).toBe(false);
    expect(calls[0].body).toMatchObject({
      systemInstruction: { parts: [{ text: "You are the Rehab Companion." }] },
      contents: [{ role: "user", parts: [{ text: "How hard should I push?" }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: "low" }, temperature: 0.3, maxOutputTokens: 350 },
    });
    expect(JSON.stringify(calls[0].body)).not.toMatch(/thinkingBudget|reasoning/i);
  });

  it("returns a structured object for generateObject, asking Gemini for JSON", async () => {
    const calls = stubFetch(() => json(reply(JSON.stringify({ conditionTitle: "Disc bulge", redFlags: [] }))));
    const { object } = await generateObject({
      model: getAiModel(GEMINI_ENV),
      schema: z.object({ conditionTitle: z.string(), redFlags: z.array(z.string()) }),
      system: "Triage.",
      messages: [{ role: "user", content: "Low back pain." }],
      maxRetries: 0,
    });
    expect(object).toEqual({ conditionTitle: "Disc bulge", redFlags: [] });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
    expect(calls[0].headers.get("x-goog-api-key")).toBe("AQ.test-key-123");
    const config = (calls[0].body as { generationConfig: Record<string, unknown> }).generationConfig;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(config.responseJsonSchema).toMatchObject({ type: "object", required: ["conditionTitle", "redFlags"] });
    expect(JSON.stringify(config.responseJsonSchema)).not.toContain("$schema");
  });

  it("sends a scan as inline data from the same message shape the triage action builds", async () => {
    const calls = stubFetch(() => json(reply("{}")));
    await generateText({
      model: getAiModel(GEMINI_ENV),
      messages: [{ role: "user", content: [{ type: "text", text: "Scans follow." }, { type: "image", image: "data:image/png;base64,AAAA" }] }],
      maxRetries: 0,
    });
    const parts = (calls[0].body as { contents: Array<{ parts: unknown[] }> }).contents[0].parts;
    expect(parts).toEqual([{ text: "Scans follow." }, { inlineData: { mimeType: "image/png", data: "AAAA" } }]);
  });

  it("surfaces a Gemini error to the caller with its message", async () => {
    stubFetch(() => json({ error: { code: 403, message: "Permission denied.", status: "PERMISSION_DENIED" } }, 403));
    await expect(generateText({ model: getAiModel(GEMINI_ENV), prompt: "Hi", maxRetries: 0 })).rejects.toThrow(/Permission denied/);
  });

  it("uses the native API for an AQ. key even when the base URL is not Google's", async () => {
    const calls = stubFetch(() => json(reply("ok")));
    await generateText({ model: getAiModel({ ...GEMINI_ENV, AI_BASE_URL: "https://proxy.example.test/v1" }), prompt: "Hi", maxRetries: 0 });
    expect(calls[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent");
  });
});

describe("other providers keep the OpenAI-compatible client", () => {
  it("posts to {base}/chat/completions with a bearer key and an unchanged body", async () => {
    const calls = stubFetch(() =>
      json({ id: "x", created: 1, model: "vendor/some-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    );
    const result = await generateText({ model: getAiModel(OPENAI_ENV), system: "Be kind.", prompt: "Hi", temperature: 0.1, maxOutputTokens: 50, maxRetries: 0 });
    expect(result.text).toBe("ok");
    expect(calls[0].url).toBe("https://ai.example.test/v1/chat/completions");
    expect(calls[0].headers.get("authorization")).toBe("Bearer sk-test-123");
    expect(calls[0].headers.has("x-goog-api-key")).toBe(false);
    expect(calls[0].body).toMatchObject({ model: "vendor/some-model", messages: [{ role: "system", content: "Be kind." }, { role: "user", content: "Hi" }], temperature: 0.1, max_tokens: 50 });
    expect(calls[0].body).not.toHaveProperty("contents");
  });

  it("still switches reasoning off for the chat model on those providers", async () => {
    const calls = stubFetch(() =>
      json({ id: "x", created: 1, model: "vendor/some-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
    );
    await generateText({ model: getChatModel(OPENAI_ENV), prompt: "Hi", maxRetries: 0 });
    expect(calls[0].url).toBe("https://ai.example.test/v1/chat/completions");
    expect(calls[0].body).toMatchObject({ reasoning: { enabled: false } });
  });
});

describe("the chat reply limit", () => {
  it("is 1200 on Gemini and unchanged elsewhere", () => {
    expect(GEMINI_CHAT_MAX_OUTPUT_TOKENS).toBe(1200);
    expect(chatMaxOutputTokens(350, GEMINI_ENV)).toBe(1200);
    expect(chatMaxOutputTokens(350, { ...GEMINI_ENV, AI_BASE_URL: "https://proxy.example.test/v1" })).toBe(1200);
    expect(chatMaxOutputTokens(350, OPENAI_ENV)).toBe(350);
  });

  it("never lowers a limit that is already higher", () => {
    expect(chatMaxOutputTokens(2000, GEMINI_ENV)).toBe(2000);
  });

  it("still reports a missing setting by name", () => {
    expect(() => chatMaxOutputTokens(350, {})).toThrow(/AI_BASE_URL, AI_API_KEY, AI_MODEL/);
  });
});
