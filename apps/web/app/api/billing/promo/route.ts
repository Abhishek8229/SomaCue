import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/entitlements";
import { billingFailure, billingJson, readJsonBody } from "@/lib/billing/http";
import { redeemPromoCode } from "@/lib/billing/promo";
import { findPromoCode, normalizePromoInput } from "@/lib/billing/promoCodes";
import { clearPromoFailures, promoRetryAfterSeconds, recordPromoFailure } from "@/lib/billing/promoThrottle";

const bodySchema = z.object({ code: z.string().max(100) });

const MESSAGES = {
  EMPTY_CODE: "Enter a promo code.",
  INVALID_CODE: "That promo code isn't valid. Check it and try again.",
  ALREADY_PRO: "You already have an active Pro plan, so a promo code can't be added to it. You can apply one after it ends.",
  ALREADY_REDEEMED: "You've already used this promo code.",
  CODE_EXHAUSTED: "This promo code has reached its limit and can't be used any more.",
  TOO_MANY_ATTEMPTS: "Too many tries. Please wait a few minutes and try again.",
} as const;

const fail = (error: keyof typeof MESSAGES, status: number, headers: Record<string, string> = {}) =>
  billingJson({ error, message: MESSAGES[error] }, status, headers);

/**
 * Redeems a promo code from PROMO_CODES for 60 days of Pro, with no payment. Signed-in users only. The code is
 * trimmed and compared in upper case. See lib/billing/promo.ts for the rules (one use per user, optional MAX_USES,
 * not while Pro is active).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return billingJson({ error: "UNAUTHENTICATED", message: "Please sign in to apply a promo code." }, 401);

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return fail("EMPTY_CODE", 400);
  const code = normalizePromoInput(parsed.data.code);
  if (!code) return fail("EMPTY_CODE", 400);

  const wait = promoRetryAfterSeconds(user.id);
  if (wait > 0) return fail("TOO_MANY_ATTEMPTS", 429, { "Retry-After": String(wait) });

  const promo = findPromoCode(code);
  if (!promo) {
    recordPromoFailure(user.id);
    return fail("INVALID_CODE", 400);
  }

  try {
    const result = await redeemPromoCode(user.id, promo);
    if (!result.ok) {
      if (result.reason === "already_pro") return fail("ALREADY_PRO", 409);
      if (result.reason === "already_redeemed") return fail("ALREADY_REDEEMED", 409);
      return fail("CODE_EXHAUSTED", 409);
    }
    clearPromoFailures(user.id);
    return billingJson({
      redeemed: true,
      durationDays: result.durationDays,
      expiresAt: result.accessEnd.toISOString(),
      billing: await getBillingStatus(user.id),
    });
  } catch (error) {
    return billingFailure(error, "promo");
  }
}