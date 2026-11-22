import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  exchangeCodeForIdToken,
  getAppOrigin,
  getGoogleConfig,
  googleRedirectUri,
  readOAuthState,
  statesMatch,
  verifyGoogleIdToken,
} from "@/lib/auth/google";
import { signInWithGoogleProfile } from "@/lib/auth/oauthAccount";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSessionCookie } from "@/lib/auth/session";

function clearState(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 0,
  });
  return response;
}

/** Finishes Google sign-in and issues SomaCue's normal session cookie. */
export async function GET(request: Request) {
  const origin = getAppOrigin(request);
  const { searchParams } = new URL(request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const stateCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);

  const fail = (code: string, next?: string) => {
    const url = new URL("/login", origin);
    url.searchParams.set("error", code);
    if (next && next !== "/workspace") url.searchParams.set("next", next);
    return clearState(NextResponse.redirect(url));
  };

  const config = getGoogleConfig();
  if (!config) return fail("google_not_configured");

  const saved = await readOAuthState(stateCookie);
  const next = safeNextPath(saved?.next);

  if (searchParams.get("error")) {
    return fail(searchParams.get("error") === "access_denied" ? "google_cancelled" : "google_failed", next);
  }

  const code = searchParams.get("code");
  if (!saved || !code || !statesMatch(saved.state, searchParams.get("state"))) {
    return fail("google_state", next);
  }

  try {
    const idToken = await exchangeCodeForIdToken({
      code,
      verifier: saved.verifier,
      redirectUri: googleRedirectUri(origin),
      config,
    });
    const profile = await verifyGoogleIdToken(idToken, { clientId: config.clientId, nonce: saved.nonce });

    const result = await signInWithGoogleProfile(profile);
    if (!result.ok) {
      return fail(result.reason === "unverified_email" ? "google_unverified" : "google_conflict", next);
    }

    await createSessionCookie(result.user);
    return clearState(NextResponse.redirect(new URL(next, origin)));
  } catch (error) {
    console.error("[SomaCue auth] Google sign-in failed.", error instanceof Error ? error.message : error);
    return fail("google_failed", next);
  }
}
