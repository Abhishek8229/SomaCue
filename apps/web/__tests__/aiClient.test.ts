// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConfigError, getAiConfig, getAiModel, getChatModel, noReasoningFetch } from "@/lib/ai/client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const FULL = { AI_BASE_URL: "https://ai.example.test/v1", AI_API_KEY: "key-123", AI_MODEL: "vendor/some-model" };

describe("AI settings come only from the environment", () => {
  it("returns the three settings as set, trimmed", () => {
    expect(getAiConfig({ AI_BASE_URL: " https://ai.example.test/v1 ", AI_API_KEY: " key-123 ", AI_MODEL: " vendor/some-model " })).toEqual({
      baseURL: "https://ai.example.test/v1",
      apiKey: "key-123",
      model: "vendor/some-model",
    });
  });

  it("throws, naming each missing setting, and never falls back", () => {
    for (const name of ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"] as const) {
      const env: Record<string, string | undefined> = { ...FULL, [name]: undefined };
      expect(() => getAiConfig(env), name).toThrow(AiConfigError);
      expect(() => getAiConfig(env), name).toThrow(new RegExp(`set ${name} in \\.env`));
    }
    expect(() => getAiConfig({})).toThrow("AI is not configured: set AI_BASE_URL, AI_API_KEY, AI_MODEL in .env.");
  });

  it("treats blank values as missing", () => {
    expect(() => getAiConfig({ ...FULL, AI_MODEL: "   " })).toThrow(/AI_MODEL/);
    expect(() => getAiConfig({ ...FULL, AI_API_KEY: "" })).toThrow(/AI_API_KEY/);
  });

  it("ignores the old chat-model variable: only AI_MODEL names a model", () => {
    expect(() => getAiModel({ AI_BASE_URL: FULL.AI_BASE_URL, AI_API_KEY: FULL.AI_API_KEY, AI_CHAT_MODEL: "old/chat-model" })).toThrow(/AI_MODEL/);
    expect(() => getChatModel({ AI_BASE_URL: FULL.AI_BASE_URL, AI_API_KEY: FULL.AI_API_KEY, AI_CHAT_MODEL: "old/chat-model" })).toThrow(/AI_MODEL/);
  });

  it("builds the triage model and the chat model from the same AI_MODEL", () => {
    const triage = getAiModel(FULL) as unknown as { modelId: string };
    const chat = getChatModel(FULL) as unknown as { modelId: string };
    expect(triage.modelId).toBe("vendor/some-model");
    expect(chat.modelId).toBe("vendor/some-model");
  });

  it("reads process.env when no environment is passed", () => {
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("AI_MODEL", "");
    expect(() => getAiModel()).toThrow(AiConfigError);
    vi.stubEnv("AI_BASE_URL", FULL.AI_BASE_URL);
    vi.stubEnv("AI_API_KEY", FULL.AI_API_KEY);
    vi.stubEnv("AI_MODEL", FULL.AI_MODEL);
    expect((getAiModel() as unknown as { modelId: string }).modelId).toBe("vendor/some-model");
  });
});

describe("no model is named anywhere in the code", () => {
  const ROOT = join(__dirname, "..");
  const FOLDERS = ["actions", "app", "lib", "components"];
  // Slugs and family names that would mean a model is hardcoded.
  const MODEL_NAMES = /nemotron|gemini-|gpt-[0-9o]|claude-|llama-?[0-9]|qwen|mistral|deepseek|:free\b/i;

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (entry === "node_modules" || entry === "generated") return [];
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx)$/.test(entry) ? [full] : [];
    });
  }

  it("has no model slug in the app, actions, lib or components", () => {
    const offenders = FOLDERS.flatMap((folder) => sources(join(ROOT, folder))).filter((file) => {
      // The movement library names "Gemini"-free anatomy terms only; this scan is for AI model names.
      return MODEL_NAMES.test(readFileSync(file, "utf8"));
    });
    expect(offenders.map((file) => file.replace(ROOT, ""))).toEqual([]);
  });

  it("has no AI_CHAT_MODEL or GEMINI_API_KEY left", () => {
    const offenders = FOLDERS.flatMap((folder) => sources(join(ROOT, folder))).filter((file) =>
      /AI_CHAT_MODEL|GEMINI_API_KEY|@google\/generative-ai/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("chat client", () => {
  it("switches reasoning off on chat requests so the answer gets the token budget", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await noReasoningFetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", max_tokens: 350, messages: [{ role: "user", content: "hi" }] }),
    });

    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.reasoning).toEqual({ enabled: false });
    expect(sent.max_tokens).toBe(350);
  });

  it("leaves other requests unchanged", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const init = { method: "POST", body: "not json" };
    await noReasoningFetch("https://example.test", init);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).toBe(init);
  });
});
