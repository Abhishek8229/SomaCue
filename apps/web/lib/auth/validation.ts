import type { UserRole } from "./session";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly UserRole[] = ["patient", "clinician", "admin"];

export const PASSWORD_MIN_LENGTH = 8;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Email is required.";
  }
  if (value.trim().length > 254 || !EMAIL_PATTERN.test(value.trim())) {
    return "Enter a valid email address.";
  }
  return null;
}

export type PasswordRule = { id: "length" | "letter" | "number"; label: string; met: boolean };

/** The checklist shown on the register form; the server enforces the same rules. */
export function passwordRules(value: string): PasswordRule[] {
  return [
    { id: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: value.length >= PASSWORD_MIN_LENGTH },
    { id: "letter", label: "One letter", met: /[A-Za-z]/.test(value) },
    { id: "number", label: "One number", met: /\d/.test(value) },
  ];
}

/** Rules for choosing a password: 8+ characters with a letter and a number. */
export function validatePassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return "Password is required.";
  }
  if (value.length > 200) {
    return "Password is too long.";
  }
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

/** Signing in only needs a value: older accounts may predate the strength rules. */
export function validateLoginPassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return "Password is required.";
  }
  if (value.length > 200) {
    return "Invalid email or password.";
  }
  return null;
}

export function validateName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Name is required.";
  }
  if (value.trim().length > 120) {
    return "Name is too long.";
  }
  return null;
}

export function validateRole(value: unknown): UserRole | null {
  if (typeof value === "string" && (ROLES as readonly string[]).includes(value)) {
    return value as UserRole;
  }
  return null;
}
