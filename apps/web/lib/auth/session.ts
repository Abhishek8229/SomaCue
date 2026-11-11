import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
} from "./jwt";

export type UserRole = "patient" | "clinician" | "admin";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type UserRecord = SessionUser & { passwordHash: string };

export type CreateUserInput = {
  email: string;
  password: string;
  name: string;
  role: UserRole;
};

const SALT_ROUNDS = 10;
const USER_ROLES: readonly string[] = ["patient", "clinician", "admin"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUserRole(value: string): value is UserRole {
  return USER_ROLES.includes(value);
}

export function toPublicUser(record: UserRecord): SessionUser {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    role: record.role,
  };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: isUserRole(user.role) ? user.role : "patient",
    passwordHash: user.passwordHash,
  };
}

export async function createUser(input: CreateUserInput): Promise<SessionUser> {
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      role: input.role,
      passwordHash,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
    },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: isUserRole(user.role) ? user.role : "patient",
  };
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed);
}

export function encryptSession(payload: SessionUser): Promise<string> {
  return signSession(payload);
}

export function decryptSession(token: string): Promise<SessionUser | null> {
  return verifySession(token);
}

export async function createSessionCookie(user: SessionUser): Promise<void> {
  const store = await cookies();
  const token = await encryptSession(user);
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return decryptSession(token);
}
