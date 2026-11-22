import { prisma } from "@/lib/db/prisma";
import type { GoogleProfile } from "./google";
import type { SessionUser, UserRole } from "./session";

const ROLES: readonly string[] = ["patient", "clinician", "admin"];

type UserRow = { id: string; email: string; name: string; role: string };

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: (ROLES.includes(row.role) ? row.role : "patient") as UserRole,
  };
}

const SELECT = { id: true, email: true, name: true, role: true } as const;

export type GoogleSignInResult =
  | { ok: true; user: SessionUser; outcome: "existing" | "linked" | "created" }
  | { ok: false; reason: "unverified_email" | "account_conflict" };

/**
 * Google is the only way in, so the User row mirrors the Google profile: name, Gmail address and
 * profile photo are saved when the account is created and refreshed on every sign-in.
 * The email follows Google only when Google says it is verified and no other account owns it.
 */
async function syncProfile(user: UserRow, profile: GoogleProfile, extra: { googleId?: string } = {}): Promise<UserRow> {
  const email = profile.email.trim().toLowerCase();
  let current = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...extra,
      avatarUrl: profile.picture,
      ...(profile.name && profile.name !== user.name ? { name: profile.name } : {}),
    },
    select: SELECT,
  });

  if (profile.emailVerified && current.email !== email) {
    try {
      current = await prisma.user.update({ where: { id: user.id }, data: { email }, select: SELECT });
    } catch {
      // Another account already uses that address: keep the one we have.
    }
  }
  return current;
}

/**
 * Turns a verified Google profile into a SomaCue user.
 * 1. Same Google id: sign in and refresh the saved profile.
 * 2. Same email already registered (an older account): link Google to it, but only when Google
 *    says the email is verified (otherwise anyone could claim an address).
 * 3. Otherwise: create a patient. There is no password: Google is the only credential.
 */
export async function signInWithGoogleProfile(profile: GoogleProfile): Promise<GoogleSignInResult> {
  const email = profile.email.trim().toLowerCase();

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: profile.sub }, select: SELECT });
  if (byGoogleId) {
    return { ok: true, user: toSessionUser(await syncProfile(byGoogleId, profile)), outcome: "existing" };
  }

  if (!profile.emailVerified) {
    return { ok: false, reason: "unverified_email" };
  }

  const byEmail = await prisma.user.findUnique({
    where: { email },
    select: { ...SELECT, googleId: true },
  });

  if (byEmail) {
    if (byEmail.googleId && byEmail.googleId !== profile.sub) {
      return { ok: false, reason: "account_conflict" };
    }
    const linked = await syncProfile(byEmail, profile, { googleId: profile.sub });
    return { ok: true, user: toSessionUser(linked), outcome: "linked" };
  }

  const created = await prisma.user.create({
    data: {
      email,
      name: profile.name || email.split("@")[0],
      role: "patient",
      googleId: profile.sub,
      avatarUrl: profile.picture,
    },
    select: SELECT,
  });
  return { ok: true, user: toSessionUser(created), outcome: "created" };
}
