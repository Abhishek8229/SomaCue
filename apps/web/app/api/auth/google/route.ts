import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  buildGoogleAuthUrl,
  createPkce,
  getAppOrigin,
  getGoogleConfig,
  googleRedirectUri,
  randomToken,
  signOAuthState,
} from "@/lib/auth/google";
import { safeNextPath } from "@/lib/auth/redirect";

/** Starts Google sign-in: sets a signed state cookie and sends the browser to Google. */
export async function GET(request: Request) {
  const origin = getAppOrigin(request);
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));

  const config = getGoogleConfig();
  if (!config) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", "google_not_configured");
    if (next !== "/workspace") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = createPkce();

  const response = NextResponse.redirect(
    buildGoogleAuthUrl({
      clientId: config.clientId,
      redirectUri: googleRedirectUri(origin),
      state,
      nonce,
      challenge,
    }),
  );

  response.cookies.set(OAUTH_STATE_COOKIE, await signOAuthState({ state, nonce, verifier, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return response;
}
