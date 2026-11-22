import { z } from "zod";
import { billingFailure, billingJson } from "@/lib/billing/http";
import { BillingConfigError, razorpayWebhookSecret, verifyWebhookSignature } from "@/lib/billing/razorpay";
import { grantPurchase, isGrantingEvent, runSerializable } from "@/lib/billing/subscriptions";
import { prisma } from "@/lib/db/prisma";

const envelopeSchema = z.object({
  event: z.string().min(1).max(100),
  payload: z
    .object({
      subscription: z
        .object({
          entity: z.object({
            id: z.string().min(1),
            status: z.string().optional(),
            customer_id: z.string().nullable().optional(),
          }),
        })
        .optional(),
      payment: z.object({ entity: z.object({ id: z.string().min(1).max(64) }) }).optional(),
    })
    .optional(),
});

/**
 * Razorpay's server-to-server events. The signature is over the exact bytes sent,
 * so the body is read as text and never re-serialised before it is checked.
 *
 * Every non-2xx answer makes Razorpay retry. So a bad signature is a 400 (a retry
 * cannot fix it), while a failure on our side is a 500 and is retried, because the
 * event row is only kept when the update succeeded.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();

  let secret: string;
  try {
    secret = razorpayWebhookSecret();
  } catch (error) {
    if (error instanceof BillingConfigError) return billingFailure(error, "webhook");
    throw error;
  }

  const signature = request.headers.get("x-razorpay-signature");
  if (!signature || !verifyWebhookSignature(rawBody, signature, secret)) {
    return billingJson({ error: "INVALID_SIGNATURE" }, 400);
  }

  const eventId = request.headers.get("x-razorpay-event-id")?.trim();
  if (!eventId || eventId.length > 128) return billingJson({ error: "MISSING_EVENT_ID" }, 400);

  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(JSON.parse(rawBody));
  } catch {
    return billingJson({ error: "INVALID_PAYLOAD" }, 400);
  }

  try {
    // Serializable, so two payments for one user that arrive together stack their days instead of overwriting each other.
    const result = await runSerializable(prisma, async (tx) => {
      // INSERT ... ON CONFLICT DO NOTHING: a delivery we have already handled adds no row.
      const recorded = await tx.billingEvent.createMany({
        data: [{ eventId, eventType: envelope.event }],
        skipDuplicates: true,
      });
      if (recorded.count === 0) return "duplicate" as const;

      // Only a payment adds days. Authentication, pending, halted and cancelled events change
      // nothing: access is the end date the purchase set, not Razorpay's running status.
      const entity = envelope.payload?.subscription?.entity;
      if (!isGrantingEvent(envelope.event) || !entity) return "ignored" as const;

      const granted = await grantPurchase(tx, {
        providerSubscriptionId: entity.id,
        providerPaymentId: envelope.payload?.payment?.entity.id ?? null,
        providerCustomerId: entity.customer_id ?? null,
      });
      return granted.result;
    });

    return billingJson({ received: true, result });
  } catch (error) {
    return billingFailure(error, "webhook");
  }
}
