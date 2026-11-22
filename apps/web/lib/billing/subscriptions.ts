import type { prisma } from "@/lib/db/prisma";
import { accessEndFor, accessStartFor, isProTier, resolvePlan, type ProTier } from "./plans";

/*
 * Turns a confirmed payment into Pro access. Used by the checkout verification (so a payment
 * unlocks Pro at once) and by the webhook (which is the safety net when the browser closes
 * before verification runs).
 *
 * Each purchase is a fixed number of days. Access is stored as the date it ends
 * (subscriptions.current_period_end), which is what the plan checks read.
 */

/** Anything with the two delegates used here: the Prisma client or a transaction. */
export type BillingDb = Pick<typeof prisma, "subscription" | "proPurchase">;

/** The webhook events that mean a payment for a subscription went through. */
export const GRANTING_EVENTS = ["subscription.activated", "subscription.charged"] as const;
export type GrantingEvent = (typeof GRANTING_EVENTS)[number];

export function isGrantingEvent(value: unknown): value is GrantingEvent {
  return typeof value === "string" && (GRANTING_EVENTS as readonly string[]).includes(value);
}

export type GrantResult =
  | { result: "granted"; tier: ProTier; accessStart: Date; accessEnd: Date }
  /** the same payment arrived twice (verify and webhook, or a retried delivery) */
  | { result: "already_granted" }
  /** no purchase of ours has this Razorpay subscription: an old or foreign one */
  | { result: "unknown_purchase" };

export type GrantInput = {
  providerSubscriptionId: string;
  providerPaymentId?: string | null;
  providerCustomerId?: string | null;
};

/**
 * Adds the purchased days to the user's Pro time. Run it inside a transaction.
 *
 * The purchase flips from "created" to "paid" in one conditional UPDATE, so of any number of
 * concurrent or repeated calls for the same payment exactly one adds the days. The days start
 * now, or at the end of the Pro time the user still has when they renew early.
 */
export async function grantPurchase(db: BillingDb, input: GrantInput, now: Date = new Date()): Promise<GrantResult> {
  const flipped = await db.proPurchase.updateMany({
    where: { providerSubscriptionId: input.providerSubscriptionId, status: "created" },
    data: { status: "paid", paidAt: now, providerPaymentId: input.providerPaymentId ?? null },
  });

  const purchase = await db.proPurchase.findUnique({ where: { providerSubscriptionId: input.providerSubscriptionId } });
  if (!purchase) return { result: "unknown_purchase" };
  if (flipped.count === 0) return { result: "already_granted" };

  const existing = await db.subscription.findUnique({ where: { userId: purchase.userId } });
  const stillPro = resolvePlan(existing, now) === "pro";
  const accessStart = accessStartFor(stillPro ? (existing?.currentPeriodEnd ?? null) : null, now);
  const accessEnd = accessEndFor(accessStart, purchase.days);
  const tier = isProTier(purchase.tier) ? purchase.tier : "1m";

  const fields = {
    provider: "razorpay",
    providerSubscriptionId: purchase.providerSubscriptionId,
    ...(input.providerCustomerId ? { providerCustomerId: input.providerCustomerId } : {}),
    plan: "pro",
    status: "active",
    currentPeriodEnd: accessEnd,
    cancelAtPeriodEnd: false,
    tier,
  };
  await db.subscription.upsert({
    where: { userId: purchase.userId },
    create: { userId: purchase.userId, ...fields },
    update: fields,
  });
  await db.proPurchase.update({ where: { id: purchase.id }, data: { accessStart, accessEnd } });

  return { result: "granted", tier, accessStart, accessEnd };
}
