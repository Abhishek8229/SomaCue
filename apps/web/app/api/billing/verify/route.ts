import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/entitlements";
import { billingFailure, billingJson, readJsonBody } from "@/lib/billing/http";
import { fetchSubscription, verifyCheckoutSignature } from "@/lib/billing/razorpay";
import { grantPurchase, runSerializable } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/db/prisma";

const bodySchema = z.object({
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_subscription_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
});

/**
 * States of a Razorpay subscription that can follow a payment the user just made. A
 * single-cycle purchase can already read "completed" if Checkout's callback was delayed.
 */
const ACTIVATABLE = new Set(["created", "authenticated", "active", "completed"]);

/**
 * Checkout's success callback. Confirms Razorpay signed the payment, then adds the purchased
 * days straight away, so a local payment unlocks without a webhook tunnel. The webhook does the
 * same for the same payment if this never runs; whichever comes second finds it already granted.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return billingJson({ error: "Please sign in." }, 401);

  const body = bodySchema.safeParse(await readJsonBody(request));
  if (!body.success) return billingJson({ error: "INVALID_REQUEST", message: "Invalid request." }, 400);
  const paymentId = body.data.razorpay_payment_id;
  const subscriptionId = body.data.razorpay_subscription_id;

  try {
    // The purchase must be one this user started. Without this, a valid signature for
    // someone else's payment could be replayed against any account.
    const purchase = await prisma.proPurchase.findUnique({ where: { providerSubscriptionId: subscriptionId } });
    if (!purchase || purchase.userId !== user.id) {
      return billingJson({ error: "SUBSCRIPTION_MISMATCH", message: "This payment does not belong to your account." }, 403);
    }

    if (!verifyCheckoutSignature({ paymentId, subscriptionId, signature: body.data.razorpay_signature })) {
      return billingJson({ error: "INVALID_SIGNATURE", message: "The payment could not be verified." }, 400);
    }

    // Already granted (by the webhook, or by this request run twice): nothing more to add.
    if (purchase.status === "paid") {
      return billingJson({ verified: true, billing: await getBillingStatus(user.id) });
    }

    const remote = await fetchSubscription(subscriptionId);
    const notedUser = Array.isArray(remote.notes) ? undefined : remote.notes?.user_id;
    if (notedUser !== undefined && notedUser !== user.id) {
      return billingJson({ error: "SUBSCRIPTION_MISMATCH", message: "This payment does not belong to your account." }, 403);
    }
    if (!ACTIVATABLE.has(remote.status)) {
      return billingJson(
        { error: "SUBSCRIPTION_NOT_ACTIVE", message: "This payment is no longer active. Please start a new checkout." },
        409,
      );
    }

    // The signature proves the payment went through, so the days are added even in the
    // moment before Razorpay's own status catches up.
    // Serializable, so a payment that arrives together with a webhook for the same user stacks its days.
    await runSerializable(prisma, (tx) =>
      grantPurchase(tx, {
        providerSubscriptionId: subscriptionId,
        providerPaymentId: paymentId,
        providerCustomerId: remote.customer_id,
      }),
    );

    return billingJson({ verified: true, billing: await getBillingStatus(user.id) });
  } catch (error) {
    return billingFailure(error, "verify");
  }
}
