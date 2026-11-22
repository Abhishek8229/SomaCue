// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRateLimits,
  consumeRateLimit,
} from "@/lib/auth/rateLimit";

beforeEach(() => clearRateLimits());

describe("consumeRateLimit", () => {
  const rule = { key: "test", limit: 3, windowMs: 60_000 };

  it("allows up to the limit, then blocks with a retry time", () => {
    const now = 1_000_000;
    expect(consumeRateLimit(rule, now).allowed).toBe(true);
    expect(consumeRateLimit(rule, now + 1_000).allowed).toBe(true);
    const third = consumeRateLimit(rule, now + 2_000);
    expect(third).toMatchObject({ allowed: true, remaining: 0 });

    const blocked = consumeRateLimit(rule, now + 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(57);
  });

  it("lets attempts through again once the window has passed", () => {
    const now = 5_000_000;
    for (let i = 0; i < 3; i += 1) consumeRateLimit(rule, now);
    expect(consumeRateLimit(rule, now + 30_000).allowed).toBe(false);
    expect(consumeRateLimit(rule, now + 61_000).allowed).toBe(true);
  });

  it("counts each key on its own", () => {
    for (let i = 0; i < 3; i += 1) consumeRateLimit(rule, 0);
    expect(consumeRateLimit({ ...rule, key: "other" }, 0).allowed).toBe(true);
  });
});
