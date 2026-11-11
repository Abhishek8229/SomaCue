// @vitest-environment node
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { userStore } = vi.hoisted(() => ({
  userStore: new Map<
    string,
    {
      id: string;
      email: string;
      name: string;
      role: string;
      passwordHash: string;
    }
  >(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: ({ where }: { where: { email: string } }) =>
        Promise.resolve(userStore.get(where.email) ?? null),
      create: ({
        data,
      }: {
        data: { email: string; name: string; role: string; passwordHash: string };
      }) => {
        const record = { id: `user-${userStore.size + 1}`, ...data };
        userStore.set(record.email, record);
        return Promise.resolve({
          id: record.id,
          email: record.email,
          name: record.name,
          role: record.role,
        });
      },
    },
  },
}));

import {
  createUser,
  decryptSession,
  encryptSession,
  findUserByEmail,
  verifyPassword,
} from "@/lib/auth/session";
import {
  validateEmail,
  validatePassword,
  validateRole,
} from "@/lib/auth/validation";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

describe("auth session engine", () => {
  beforeEach(() => {
    userStore.clear();
  });

  it("hashes a password and verifies only the correct plain text", async () => {
    const hash = await bcrypt.hash("Password123", 10);
    await expect(verifyPassword("Password123", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("encrypts and decrypts a session payload", async () => {
    const user = {
      id: "user-1",
      email: "patient@somacue.internal",
      name: "Default Patient",
      role: "patient" as const,
    };
    const token = await encryptSession(user);
    expect(typeof token).toBe("string");
    await expect(decryptSession(token)).resolves.toEqual(user);
  });

  it("returns null for a malformed token", async () => {
    await expect(decryptSession("not-a-jwt")).resolves.toBeNull();
  });

  it("creates a user, normalizes the email and finds the record", async () => {
    const created = await createUser({
      email: "Clinician@Example.com",
      password: "Password123",
      name: "Dr. Example",
      role: "clinician",
    });
    expect(created.email).toBe("clinician@example.com");

    const found = await findUserByEmail("clinician@example.com");
    expect(found?.name).toBe("Dr. Example");
    expect(found?.role).toBe("clinician");

    const stored = userStore.get("clinician@example.com");
    expect(stored?.passwordHash).not.toBe("Password123");
    await expect(verifyPassword("Password123", stored?.passwordHash ?? "")).resolves.toBe(
      true,
    );
  });
});

describe("auth input validation", () => {
  it("rejects invalid email addresses", () => {
    expect(validateEmail("not-an-email")).not.toBeNull();
    expect(validateEmail("")).not.toBeNull();
    expect(validateEmail("user@example.com")).toBeNull();
  });

  it("enforces the minimum password length", () => {
    expect(validatePassword("short")).not.toBeNull();
    expect(validatePassword("Password123")).toBeNull();
  });

  it("only accepts known roles", () => {
    expect(validateRole("patient")).toBe("patient");
    expect(validateRole("clinician")).toBe("clinician");
    expect(validateRole("admin")).toBe("admin");
    expect(validateRole("superuser")).toBeNull();
  });
});
