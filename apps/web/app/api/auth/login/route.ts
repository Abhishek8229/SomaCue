import { NextResponse } from "next/server";
import {
  createSessionCookie,
  findUserByEmail,
  toPublicUser,
  verifyPassword,
} from "@/lib/auth/session";
import { validateEmail, validatePassword } from "@/lib/auth/validation";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const emailError = validateEmail(body.email);
  if (emailError) {
    return NextResponse.json({ success: false, error: emailError }, { status: 400 });
  }

  const passwordError = validatePassword(body.password);
  if (passwordError) {
    return NextResponse.json({ success: false, error: passwordError }, { status: 400 });
  }

  const record = await findUserByEmail(String(body.email));
  if (!record) {
    return NextResponse.json(
      { success: false, error: "Invalid email or password." },
      { status: 401 },
    );
  }

  const passwordValid = await verifyPassword(String(body.password), record.passwordHash);
  if (!passwordValid) {
    return NextResponse.json(
      { success: false, error: "Invalid email or password." },
      { status: 401 },
    );
  }

  const user = toPublicUser(record);
  await createSessionCookie(user);

  return NextResponse.json({ success: true, user });
}
