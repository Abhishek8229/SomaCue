// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps relative paths inside the app", () => {
    expect(safeNextPath("/workspace")).toBe("/workspace");
    expect(safeNextPath("/dashboard?tab=plan")).toBe("/dashboard?tab=plan");
    expect(safeNextPath("/workspace#today")).toBe("/workspace#today");
  });

  it("falls back to the workspace when nothing usable is given", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath(null)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath("")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath(42)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it.each([
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/%252F%252Fevil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "evil.example/path",
    "workspace",
    "/work\nspace",
    "/work%0d%0aspace",
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("does not bounce people back into the sign-in pages", () => {
    expect(safeNextPath("/login")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath("/register?next=/workspace")).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeNextPath("/api/auth/logout")).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("uses a custom fallback and rejects very long values", () => {
    expect(safeNextPath("https://evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNextPath(`/${"a".repeat(600)}`)).toBe(DEFAULT_AFTER_SIGN_IN);
  });
});
