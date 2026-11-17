// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimits,
  clearRateLimits,
  clientIp,
  consumeRateLimit,
  loginRules,
  rateLimitMessage,
  registerRules,
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

describe("login and register rules", () => {
  it("blocks the sixth sign-in attempt for one IP and email, not another email", () => {
    const now = 10_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimits(loginRules("203.0.113.9", "a@example.com"), now).allowed).toBe(true);
    }
    expect(checkRateLimits(loginRules("203.0.113.9", "a@example.com"), now).allowed).toBe(false);
    expect(checkRateLimits(loginRules("203.0.113.9", "b@example.com"), now).allowed).toBe(true);
  });

  it("blocks the fourth registration for one IP and email in an hour", () => {
    const now = 20_000_000;
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimits(registerRules("198.51.100.4", "new@example.com"), now).allowed).toBe(true);
    }
    expect(checkRateLimits(registerRules("198.51.100.4", "new@example.com"), now).allowed).toBe(false);
  });

  it("limits one IP across many emails", () => {
    const now = 30_000_000;
    let blockedAt = 0;
    for (let i = 1; i <= 40; i += 1) {
      if (!checkRateLimits(loginRules("192.0.2.1", `user${i}@example.com`), now).allowed) {
        blockedAt = i;
        break;
      }
    }
    expect(blockedAt).toBe(31);
  });
});

describe("helpers", () => {
  it("reads the client address from proxy headers", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("words the wait in minutes", () => {
    expect(rateLimitMessage(30)).toBe("Too many attempts. Try again in 1 minute.");
    expect(rateLimitMessage(601)).toBe("Too many attempts. Try again in 11 minutes.");
  });
});
