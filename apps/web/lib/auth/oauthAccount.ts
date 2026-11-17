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
 * Turns a verified Google profile into a SomaCue user.
 * 1. Same Google id: sign in.
 * 2. Same email already registered: link Google to it, but only when Google
 *    says the email is verified (otherwise anyone could claim an address).
 * 3. Otherwise: create a patient with no local password.
 */
export async function signInWithGoogleProfile(profile: GoogleProfile): Promise<GoogleSignInResult> {
  const email = profile.email.trim().toLowerCase();

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: profile.sub }, select: SELECT });
  if (byGoogleId) {
    return { ok: true, user: toSessionUser(byGoogleId), outcome: "existing" };
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
    const linked = await prisma.user.update({
      where: { id: byEmail.id },
      data: { googleId: profile.sub, avatarUrl: profile.picture },
      select: SELECT,
    });
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
