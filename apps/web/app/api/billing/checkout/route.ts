import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { checkRateLimits } from "@/lib/auth/rateLimit";
import { billingFailure, billingJson, readJsonBody } from "@/lib/billing/http";
import { isProTier, PRO_TIERS } from "@/lib/billing/plans";
import { createSubscription, fetchSubscription, razorpayKeyId, RazorpayError } from "@/lib/billing/razorpay";
import { prisma } from "@/lib/db/prisma";

const FIFTEEN_MINUTES = 15 * 60_000;
/** An unpaid checkout this young is reused instead of creating another one. */
const REUSE_WINDOW_MS = 60 * 60_000;

const bodySchema = z.object({ tier: z.string().refine(isProTier, "Unknown tier.") });

/**
 * Starts a Pro purchase of the chosen tier (1m, 2m or 3m) and gives Checkout what it needs to open.
 * The price and the days come from the server's own table for that tier, never from the browser.
 * Only a purchase row in "created" is saved: nothing unlocks until the payment is verified.
 * A user who still has Pro can buy again; the new days are added after the ones they have.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return billingJson({ error: "Please sign in." }, 401);

  const body = bodySchema.safeParse(await readJsonBody(request));
  if (!body.success) return billingJson({ error: "INVALID_TIER", message: "Choose 1, 2 or 3 months." }, 400);
  const tier = body.data.tier as keyof typeof PRO_TIERS;
  const info = PRO_TIERS[tier];

  const limit = checkRateLimits([{ key: `billing:checkout:${user.id}`, limit: 8, windowMs: FIFTEEN_MINUTES }]);
  if (!limit.allowed) {
    return billingJson(
      { error: "RATE_LIMITED", message: "Too many attempts. Please wait a few minutes and try again." },
      429,
      { "Retry-After": String(limit.retryAfterSeconds) },
    );
  }

  try {
    // An unpaid checkout for the same tier that the user abandoned: reuse it.
    const open = await prisma.proPurchase.findFirst({
      where: {
        userId: user.id,
        tier,
        status: "created",
        createdAt: { gt: new Date(Date.now() - REUSE_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (open) {
      try {
        const remote = await fetchSubscription(open.providerSubscriptionId);
        if (remote.status === "created") {
          return billingJson({ subscriptionId: remote.id, keyId: razorpayKeyId(), tier, amountMinor: info.amountMinor });
        }
      } catch (error) {
        // A subscription Razorpay no longer knows is simply replaced below.
        if (!(error instanceof RazorpayError)) throw error;
      }
    }

    const subscription = await createSubscription(user.id, tier);
    await prisma.proPurchase.create({
      data: {
        userId: user.id,
        providerSubscriptionId: subscription.id,
        tier,
        days: info.days,
        amountMinor: info.amountMinor,
      },
    });

    return billingJson({ subscriptionId: subscription.id, keyId: razorpayKeyId(), tier, amountMinor: info.amountMinor });
  } catch (error) {
    return billingFailure(error, "checkout");
  }
}
