import { prisma } from "@/lib/db/prisma";
import { accessEndFor, resolvePlan } from "./plans";
import { PROMO_DURATION_DAYS, PROMO_TIER, type PromoCode } from "./promoCodes";
import { runSerializable } from "./subscriptions";

/*
 * Redeeming a promo code: 60 days of Pro with no payment. It writes the same subscription fields a paid purchase does
 * (`plan`, `status`, `currentPeriodEnd`, `tier`), so every Pro check (`resolvePlan`, the Companion limits, the schedule
 * window, the Pro badge) works without knowing the days came from a code.
 *
 * It runs in one Serializable transaction, like granting a purchase. Two requests that race (the same user twice, or
 * two users on the last use of a capped code) cannot both win: one is rolled back by the database and retried, and
 * sees the other's result.
 */

export type RedeemResult =
  | { ok: true; accessStart: Date; accessEnd: Date; durationDays: number }
  /** the user already has an active Pro plan (a purchase or an earlier code), so days would stack */
  | { ok: false; reason: "already_pro"; currentPeriodEnd: Date | null }
  /** this user already used this code */
  | { ok: false; reason: "already_redeemed" }
  /** the code's MAX_USES have all been used */
  | { ok: false; reason: "exhausted" };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

export async function redeemPromoCode(
  userId: string,
  promo: PromoCode,
  now: Date = new Date(),
  client: Pick<typeof prisma, "$transaction"> = prisma,
): Promise<RedeemResult> {
  try {
    return await runSerializable(client, async (tx): Promise<RedeemResult> => {
      const existing = await tx.subscription.findUnique({ where: { userId } });
      // No stacking, and no colliding with an active Razorpay purchase: while Pro is on, a code cannot be used.
      if (resolvePlan(existing, now) === "pro") {
        return { ok: false, reason: "already_pro", currentPeriodEnd: existing?.currentPeriodEnd ?? null };
      }

      const mine = await tx.promoRedemption.findUnique({ where: { userId_code: { userId, code: promo.code } } });
      if (mine) return { ok: false, reason: "already_redeemed" };

      if (promo.maxUses !== null) {
        const used = await tx.promoRedemption.count({ where: { code: promo.code } });
        if (used >= promo.maxUses) return { ok: false, reason: "exhausted" };
      }

      const accessEnd = accessEndFor(now, PROMO_DURATION_DAYS);
      await tx.promoRedemption.create({ data: { userId, code: promo.code, durationDays: PROMO_DURATION_DAYS, redeemedAt: now } });

      const fields = { provider: "promo", plan: "pro", status: "active", currentPeriodEnd: accessEnd, cancelAtPeriodEnd: false, tier: PROMO_TIER };
      await tx.subscription.upsert({ where: { userId }, create: { userId, ...fields }, update: fields });

      return { ok: true, accessStart: now, accessEnd, durationDays: PROMO_DURATION_DAYS };
    });
  } catch (error) {
    // The same user redeeming the same code twice at once: the unique key stops the second one.
    if (isUniqueViolation(error)) return { ok: false, reason: "already_redeemed" };
    throw error;
  }
}