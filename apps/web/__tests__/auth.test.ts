// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
}));

import { signSession, verifySession } from "@/lib/auth/jwt";
import * as session from "@/lib/auth/session";

describe("auth session engine", () => {
  it("signs and verifies a session payload", async () => {
    const user = {
      id: "user-1",
      email: "patient@somacue.internal",
      name: "Default Patient",
      role: "patient" as const,
    };
    const token = await signSession(user);
    expect(typeof token).toBe("string");
    await expect(verifySession(token)).resolves.toEqual(user);
  });

  it("returns null for a malformed token", async () => {
    await expect(verifySession("not-a-jwt")).resolves.toBeNull();
  });

  it("has no pass-through encrypt or decrypt wrappers: the session helpers sign and verify directly", () => {
    expect(session).not.toHaveProperty("encryptSession");
    expect(session).not.toHaveProperty("decryptSession");
    expect(typeof session.createSessionCookie).toBe("function");
    expect(typeof session.getCurrentUser).toBe("function");
  });
});
