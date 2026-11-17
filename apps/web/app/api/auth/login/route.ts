import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { checkRateLimits, clientIp, loginRules, rateLimitMessage } from "@/lib/auth/rateLimit";
import { safeNextPath } from "@/lib/auth/redirect";
import {
  createSessionCookie,
  findUserByEmail,
  toPublicUser,
  verifyPassword,
} from "@/lib/auth/session";
import { normalizeEmail, validateEmail, validateLoginPassword } from "@/lib/auth/validation";

type LoginBody = {
  email?: unknown;
  password?: unknown;
  next?: unknown;
};

// Unknown emails still pay for one bcrypt compare, so timing does not reveal which emails exist.
const dummyHash = bcrypt.hash(randomUUID(), 10);

function fail(status: number, error: string, extra: Record<string, unknown> = {}, headers?: HeadersInit) {
  return NextResponse.json({ success: false, error, ...extra }, { status, headers });
}

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return fail(400, "Request body must be valid JSON.");
  }

  const emailError = validateEmail(body.email);
  if (emailError) return fail(400, emailError, { field: "email" });

  const passwordError = validateLoginPassword(body.password);
  if (passwordError) return fail(400, passwordError, { field: "password" });

  const email = normalizeEmail(String(body.email));
  const limit = checkRateLimits(loginRules(clientIp(request.headers), email));
  if (!limit.allowed) {
    return fail(429, rateLimitMessage(limit.retryAfterSeconds), {}, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const record = await findUserByEmail(email);
  if (!record) {
    await verifyPassword(String(body.password), await dummyHash);
    return fail(401, "Invalid email or password.");
  }

  if (!record.passwordHash) {
    return fail(
      401,
      "This account signs in with Google. Choose Continue with Google instead.",
      { code: "google_only" },
    );
  }

  const passwordValid = await verifyPassword(String(body.password), record.passwordHash);
  if (!passwordValid) return fail(401, "Invalid email or password.");

  const user = toPublicUser(record);
  await createSessionCookie(user);

  return NextResponse.json({ success: true, user, next: safeNextPath(body.next) });
}
