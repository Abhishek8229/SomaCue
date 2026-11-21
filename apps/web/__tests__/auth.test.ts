// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

import { decryptSession, encryptSession } from "@/lib/auth/session";

describe("auth session engine", () => {
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
});
