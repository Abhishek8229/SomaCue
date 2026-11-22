import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
} from "./jwt";

export type UserRole = "patient" | "clinician" | "admin";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export function encryptSession(payload: SessionUser): Promise<string> {
  return signSession(payload);
}

export function decryptSession(token: string): Promise<SessionUser | null> {
  return verifySession(token);
}

export async function createSessionCookie(user: SessionUser): Promise<void> {
  const store = await cookies();
  const token = await encryptSession(user);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decryptSession(token);
}
