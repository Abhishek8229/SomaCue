// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MIN_SECRET_LENGTH, resolveSessionSecret } from "@/lib/auth/jwt";

const STRONG = "x".repeat(MIN_SECRET_LENGTH);

describe("resolveSessionSecret", () => {
  it("refuses to run in production without a secret", () => {
    expect(() => resolveSessionSecret({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
  });

  it("refuses a secret shorter than 32 characters in production", () => {
    expect(() => resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "short" })).toThrow(
      /at least 32/,
    );
  });

  it("accepts a strong secret in production", () => {
    expect(resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: STRONG })).toBe(STRONG);
  });

  it("uses a local fallback outside production when the secret is missing or weak", () => {
    const fallback = resolveSessionSecret({ NODE_ENV: "development" });
    expect(fallback.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(resolveSessionSecret({ NODE_ENV: "development", SESSION_SECRET: "short" })).toBe(fallback);
    expect(resolveSessionSecret({ NODE_ENV: "development", SESSION_SECRET: STRONG })).toBe(STRONG);
  });
});
