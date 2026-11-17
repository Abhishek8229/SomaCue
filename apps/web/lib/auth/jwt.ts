import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./session";

export const SESSION_COOKIE = "somacue_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
export const MIN_SECRET_LENGTH = 32;

/** Used only outside production when SESSION_SECRET is not set. */
const DEV_FALLBACK_SECRET = "somacue-local-development-only-secret-do-not-deploy";

let cachedKey: { secret: string; key: Uint8Array } | null = null;

/**
 * The signing secret, read when first needed (not at import) so builds without
 * secrets still work. Production refuses to run without a strong secret.
 */
export function resolveSessionSecret(
  env: { SESSION_SECRET?: string; NODE_ENV?: string } = process.env,
): string {
  const secret = env.SESSION_SECRET?.trim();
  if (env.NODE_ENV === "production") {
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production.`,
      );
    }
    return secret;
  }
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : DEV_FALLBACK_SECRET;
}

export function getSecretKey(): Uint8Array {
  const secret = resolveSessionSecret();
  if (!cachedKey || cachedKey.secret !== secret) {
    cachedKey = { secret, key: new TextEncoder().encode(secret) };
  }
  return cachedKey.key;
}

export async function signSession(payload: SessionUser): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    return {
      id: String(payload.id ?? ""),
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: payload.role as SessionUser["role"],
    };
  } catch (error) {
    // A missing production secret is a deployment fault, not a bad token.
    if (error instanceof Error && error.message.startsWith("SESSION_SECRET")) throw error;
    return null;
  }
}
