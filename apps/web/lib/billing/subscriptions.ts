import { Prisma } from "@/generated/prisma/client";
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

/** How many times a transaction that lost a serialization race is run again before giving up. */
export const SERIALIZATION_ATTEMPTS = 6;

/** Prisma's code for "this transaction conflicted with another and was rolled back": safe to run again. */
export function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2034";
}

/**
 * Runs `work` in a Serializable transaction and runs it again if it loses a race with another one.
 *
 * Granting days reads the current end of the user's Pro time and writes a new one. Two payments for
 * the same user that arrive together (two webhooks, or a webhook and the browser's verify call) would
 * both read the same end and the second write would erase the first one's days. Serializable
 * isolation makes the database roll one of them back instead, and the retry then reads the other's
 * result, so every purchased day stacks. Anything that is not a conflict is thrown straight away.
 */
export async function runSerializable<T>(
  client: Pick<typeof prisma, "$transaction">,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts: number = SERIALIZATION_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= attempts) throw error;
      // A short, growing pause with jitter, so two retries do not collide again in step.
      await new Promise((resolve) => setTimeout(resolve, 5 * 2 ** attempt + Math.random() * 10));
    }
  }
}

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
 * Adds the purchased days to the user's Pro time. Run it through `runSerializable`.
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
