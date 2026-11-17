/** Error codes the Google routes put in ?error=, with the text people see. */
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "Google sign-in isn't set up on this server yet. Use your email and password instead.",
  google_cancelled: "Google sign-in was cancelled. You can try again or use your email.",
  google_state: "That Google sign-in link expired. Start again with Continue with Google.",
  google_failed: "We couldn't complete Google sign-in. Try again, or use your email and password.",
  google_unverified:
    "Google says this email address isn't verified, so we can't sign you in with it. Verify it with Google or use email and password.",
  google_conflict: "This email is already linked to a different Google account.",
};

export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? "Sign-in failed. Try again.";
}
