import { NextResponse } from "next/server";
import {
  createSessionCookie,
  createUser,
  findUserByEmail,
} from "@/lib/auth/session";
import {
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/auth/validation";

type RegisterBody = {
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
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

  const nameError = validateName(body.name);
  if (nameError) {
    return NextResponse.json({ success: false, error: nameError }, { status: 400 });
  }

  const email = String(body.email).trim().toLowerCase();
  if (await findUserByEmail(email)) {
    return NextResponse.json(
      { success: false, error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const user = await createUser({
    email,
    password: String(body.password),
    name: String(body.name),
    role: "patient",
  });
  await createSessionCookie(user);

  return NextResponse.json({ success: true, user }, { status: 201 });
}
