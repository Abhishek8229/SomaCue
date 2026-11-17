import { NextResponse } from "next/server";
import { checkRateLimits, clientIp, rateLimitMessage, registerRules } from "@/lib/auth/rateLimit";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSessionCookie, createUser, findUserByEmail } from "@/lib/auth/session";
import {
  normalizeEmail,
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/auth/validation";

type RegisterBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  next?: unknown;
};

function fail(status: number, error: string, extra: Record<string, unknown> = {}, headers?: HeadersInit) {
  return NextResponse.json({ success: false, error, ...extra }, { status, headers });
}

export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return fail(400, "Request body must be valid JSON.");
  }

  const nameError = validateName(body.name);
  if (nameError) return fail(400, nameError, { field: "name" });

  const emailError = validateEmail(body.email);
  if (emailError) return fail(400, emailError, { field: "email" });

  const passwordError = validatePassword(body.password);
  if (passwordError) return fail(400, passwordError, { field: "password" });

  const email = normalizeEmail(String(body.email));
  const limit = checkRateLimits(registerRules(clientIp(request.headers), email));
  if (!limit.allowed) {
    return fail(429, rateLimitMessage(limit.retryAfterSeconds), {}, {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return fail(
      409,
      existing.passwordHash
        ? "An account with this email already exists. Sign in instead."
        : "An account with this email already exists and uses Google. Choose Continue with Google.",
      { field: "email" },
    );
  }

  const user = await createUser({
    email,
    password: String(body.password),
    name: String(body.name),
    role: "patient",
  });
  await createSessionCookie(user);

  return NextResponse.json({ success: true, user, next: safeNextPath(body.next) }, { status: 201 });
}
