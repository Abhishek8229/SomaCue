import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getSecretKey } from "./jwt";

/**
 * Google sign-in with the OAuth 2.0 authorization code flow plus PKCE.
 * No auth framework: a signed state cookie ties the callback to the browser
 * that started it, and the ID token is verified against Google's public keys.
 */

export const OAUTH_STATE_COOKIE = "somacue_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleConfig = { clientId: string; clientSecret: string };

export type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
};

type Env = Record<string, string | undefined>;

/** Null until both values are set, so callers can show a friendly message. */
export function getGoogleConfig(env: Env = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The public origin of the app: NEXT_PUBLIC_APP_URL, else the request's own. */
export function getAppOrigin(request: Request, env: Env = process.env): string {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request origin
    }
  }
  return new URL(request.url).origin;
}

export function googleRedirectUri(origin: string): string {
  return `${origin}/api/auth/google/callback`;
}

const base64url = (buffer: Buffer) => buffer.toString("base64url");

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export type OAuthState = { state: string; nonce: string; verifier: string; next: string };

/** The cookie value: everything the callback needs, signed so it cannot be forged. */
export async function signOAuthState(payload: OAuthState): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_MAX_AGE_SECONDS}s`)
    .sign(getSecretKey());
}

export async function readOAuthState(token: string | undefined): Promise<OAuthState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    const { state, nonce, verifier, next } = payload as Record<string, unknown>;
    if (
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof verifier !== "string" ||
      typeof next !== "string"
    ) {
      return null;
    }
    return { state, nonce, verifier, next };
  } catch {
    return null;
  }
}

/** Constant-time comparison for the state returned by Google. */
export function statesMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildGoogleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** Swaps the one-time code for an ID token. */
export async function exchangeCodeForIdToken(
  input: { code: string; verifier: string; redirectUri: string; config: GoogleConfig },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }).toString(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`);
  const body = (await response.json()) as { id_token?: unknown };
  if (typeof body.id_token !== "string" || body.id_token.length === 0) {
    throw new Error("Google did not return an ID token.");
  }
  return body.id_token;
}

let remoteKeys: JWTVerifyGetKey | null = null;

/** Verifies signature, issuer, audience, expiry and nonce, then reads the profile. */
export async function verifyGoogleIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  keys?: JWTVerifyGetKey,
): Promise<GoogleProfile> {
  const getKey = keys ?? (remoteKeys ??= createRemoteJWKSet(JWKS_URL));
  const { payload } = await jwtVerify(idToken, getKey, {
    issuer: ISSUERS,
    audience: expected.clientId,
    algorithms: ["RS256"],
  });

  if (payload.nonce !== expected.nonce) throw new Error("Google ID token nonce mismatch.");
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new Error("Google ID token is missing the account id or email.");
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "",
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
