// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  passwordRules,
  validateEmail,
  validateLoginPassword,
  validateName,
  validatePassword,
} from "@/lib/auth/validation";

describe("email", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Patient@Example.COM ")).toBe("patient@example.com");
  });

  it("rejects empty, malformed and oversized addresses", () => {
    expect(validateEmail("")).toBe("Email is required.");
    expect(validateEmail(undefined)).toBe("Email is required.");
    expect(validateEmail("no-at-sign")).toBe("Enter a valid email address.");
    expect(validateEmail("a@b")).toBe("Enter a valid email address.");
    expect(validateEmail(`${"a".repeat(250)}@example.com`)).toBe("Enter a valid email address.");
    expect(validateEmail(" patient@example.com ")).toBeNull();
  });
});

describe("password when choosing one", () => {
  it("needs 8 characters, a letter and a number", () => {
    expect(validatePassword("")).toBe("Password is required.");
    expect(validatePassword("Ab1")).toMatch(/at least 8 characters/);
    expect(validatePassword("abcdefghij")).toMatch(/letter and one number/);
    expect(validatePassword("12345678")).toMatch(/letter and one number/);
    expect(validatePassword("Rehab2026")).toBeNull();
  });

  it("reports each rule for the live checklist", () => {
    const met = (value: string) => Object.fromEntries(passwordRules(value).map((rule) => [rule.id, rule.met]));
    expect(met("")).toEqual({ length: false, letter: false, number: false });
    expect(met("abc")).toEqual({ length: false, letter: true, number: false });
    expect(met("abcdefg1")).toEqual({ length: true, letter: true, number: true });
  });
});

describe("password when signing in", () => {
  it("only requires a value, so older accounts can still sign in", () => {
    expect(validateLoginPassword("")).toBe("Password is required.");
    expect(validateLoginPassword("short")).toBeNull();
  });
});

describe("name", () => {
  it("is required and bounded", () => {
    expect(validateName("   ")).toBe("Name is required.");
    expect(validateName("a".repeat(121))).toBe("Name is too long.");
    expect(validateName("Asha Rao")).toBeNull();
  });
});
