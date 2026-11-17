/** Where people land after signing in when no safe ?next= was given. */
export const DEFAULT_AFTER_SIGN_IN = "/workspace";

/**
 * Accepts only a relative path inside this app. Anything that could leave the
 * site (absolute URLs, protocol-relative "//host", backslashes, control
 * characters, encoded variants of those) falls back to the default.
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  if (raw.length === 0 || raw.length > 512) return fallback;

  let decoded = raw;
  try {
    // Decode twice so "%2F%2Fevil.com" and "%252F%252F" are judged as what they become.
    decoded = decodeURIComponent(decodeURIComponent(raw));
  } catch {
    return fallback;
  }

  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith("/")) return fallback;
    if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;
    if (candidate.includes("\\")) return fallback;
    if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
    if (/^\/[a-z][a-z0-9+.-]*:/i.test(candidate)) return fallback;
  }

  // Never bounce back into the auth pages or the auth API.
  const path = raw.split(/[?#]/)[0];
  if (/^\/(login|register|api\/auth)(\/|$)/.test(path)) return fallback;

  return raw;
}
