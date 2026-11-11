import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./session";

export const SESSION_COOKIE = "somacue_session";
export const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "somacue-deterministic-entropy-secret-min32chars";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

const secretKey = new TextEncoder().encode(SESSION_SECRET);

export async function signSession(payload: SessionUser): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secretKey);
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    return {
      id: String(payload.id ?? ""),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: payload.role as SessionUser["role"],
    };
  } catch {
    return null;
  }
}
