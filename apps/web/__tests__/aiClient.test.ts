// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { noReasoningFetch } from "@/lib/ai/client";

afterEach(() => vi.unstubAllGlobals());

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
