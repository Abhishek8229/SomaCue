import type { UserRole } from "./session";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly UserRole[] = ["patient", "clinician", "admin"];

export function validateEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Email is required.";
  }
  if (!EMAIL_PATTERN.test(value.trim())) {
    return "Enter a valid email address.";
  }
  return null;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return "Password is required.";
  }
  if (value.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

export function validateName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Name is required.";
  }
  return null;
}

export function validateRole(value: unknown): UserRole | null {
  if (typeof value === "string" && (ROLES as readonly string[]).includes(value)) {
    return value as UserRole;
  }
  return null;
}
