import { createHmac, timingSafeEqual } from "node:crypto";
import { PRO_TIERS, type ProTier } from "./plans";

/*
 * Razorpay, server side only. Plain REST with Basic auth: four endpoints do not
 * justify an SDK, and fetch is easy to stub in tests. Never import this from a
 * client component: it reads RAZORPAY_KEY_SECRET.
 */

const API = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 20_000;
/**
 * Every Pro purchase is one Razorpay subscription with a single billing cycle: one payment,
 * one fixed window of access, no automatic renewals. (A plan with period "monthly" and
 * interval 2 or 3 is what makes the 2 and 3 month bundles one charge.)
 */
export const PURCHASE_TOTAL_COUNT = 1;

export class BillingConfigError extends Error {
  constructor(name: string) {
    super(`${name} is not set. Billing is unavailable until it is configured.`);
    this.name = "BillingConfigError";
  }
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

function required(name: "RAZORPAY_KEY_ID" | "RAZORPAY_KEY_SECRET" | "RAZORPAY_WEBHOOK_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) throw new BillingConfigError(name);
  return value;
}

/** The public key id, safe to give to the browser for Checkout. */
export function razorpayKeyId() {
  return required("RAZORPAY_KEY_ID");
}

export function razorpayWebhookSecret() {
  return required("RAZORPAY_WEBHOOK_SECRET");
}

/** Razorpay's subscription object, the fields this app reads. Times are Unix seconds. */
export type RazorpaySubscription = {
  id: string;
  status: string;
  plan_id: string;
  customer_id: string | null;
  current_start: number | null;
  current_end: number | null;
  charge_at: number | null;
  paid_count?: number;
  remaining_count?: number;
  notes?: Record<string, string> | unknown[] | null;
};

async function razorpay<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const auth = Buffer.from(`${required("RAZORPAY_KEY_ID")}:${required("RAZORPAY_KEY_SECRET")}`).toString("base64");
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; description?: string } } | null;
  if (!response.ok) {
    throw new RazorpayError(
      data?.error?.description ?? `Razorpay returned HTTP ${response.status}.`,
      response.status,
      data?.error?.code ?? null,
    );
  }
  return data as T;
}

/** Optional environment variables that pin a tier to a plan made in the Razorpay dashboard. */
const PLAN_ENV: Record<ProTier, string> = {
  "1m": "RAZORPAY_PRO_PLAN_ID",
  "2m": "RAZORPAY_PRO_PLAN_2M_ID",
  "3m": "RAZORPAY_PRO_PLAN_3M_ID",
};

type RazorpayPlan = {
  id: string;
  period: string;
  interval: number;
  item: { name?: string; amount: number; currency: string };
};

const planCache = new Map<ProTier, string>();

/** Is this Razorpay plan the single-payment plan for the tier: monthly x N at the tier's price? */
function isPlanFor(plan: RazorpayPlan, tier: ProTier): boolean {
  const info = PRO_TIERS[tier];
  return (
    plan.period === "monthly" &&
    plan.interval === info.months &&
    plan.item?.amount === info.amountMinor &&
    plan.item?.currency === info.currency
  );
}

/** Test hook: forget plans found or created earlier in this process. */
export function clearPlanCache() {
  planCache.clear();
}

/**
 * The Razorpay plan for a tier: the one named in the environment when set, otherwise one found
 * (or created once) through the API, so checkout works in Test and Live mode with no setup.
 */
export async function planIdForTier(tier: ProTier): Promise<string> {
  const cached = planCache.get(tier);
  if (cached) return cached;

  const info = PRO_TIERS[tier];

  // A plan named in the environment is used only if it really is this tier's plan (period,
  // length and price). After a price change an old plan id left in .env would otherwise keep
  // charging the old amount, so a mismatch is ignored and the right plan is found or created.
  const fromEnv = process.env[PLAN_ENV[tier]]?.trim();
  if (fromEnv) {
    const configured = await razorpay<RazorpayPlan>(`/plans/${encodeURIComponent(fromEnv)}`).catch((error: unknown) => {
      if (error instanceof RazorpayError && error.status >= 400 && error.status < 500) return null;
      throw error;
    });
    if (configured && isPlanFor(configured, tier)) {
      planCache.set(tier, configured.id);
      return configured.id;
    }
    console.warn(`[SomaCue billing] ${PLAN_ENV[tier]} (${fromEnv}) is not a ${info.label} plan for ${info.name}; using the right one instead.`);
  }

  const existing = await razorpay<{ items?: RazorpayPlan[] }>("/plans?count=100");
  const match = existing.items?.find((plan) => isPlanFor(plan, tier) && plan.item?.name?.startsWith("SomaCue Pro"));
  const plan =
    match ??
    (await razorpay<RazorpayPlan>("/plans", {
      method: "POST",
      body: {
        period: "monthly",
        interval: info.months,
        item: {
          name: `SomaCue Pro ${info.name}`,
          description: `${info.span} of SomaCue Pro, one payment`,
          amount: info.amountMinor,
          currency: info.currency,
        },
        notes: { tier },
      },
    }));
  planCache.set(tier, plan.id);
  return plan.id;
}

export async function createSubscription(userId: string, tier: ProTier) {
  return razorpay<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: {
      plan_id: await planIdForTier(tier),
      total_count: PURCHASE_TOTAL_COUNT,
      customer_notify: 1,
      notes: { user_id: userId, tier },
    },
  });
}
export function fetchSubscription(subscriptionId: string) {
  return razorpay<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

/** Unix seconds to a Date; null for a missing or zero time. */
export function fromUnixSeconds(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

function hmacHex(secret: string, message: string) {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Constant-time comparison of two hex signatures. A wrong length is simply false. */
function signaturesMatch(expected: string, received: string) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checkout's success callback: HMAC-SHA256 of `payment_id|subscription_id` with the
 * key secret. (For orders the two ids are the other way round; for subscriptions
 * this is the order Razorpay signs.)
 */
export function verifyCheckoutSignature(
  input: { paymentId: string; subscriptionId: string; signature: string },
  secret: string = required("RAZORPAY_KEY_SECRET"),
) {
  return signaturesMatch(hmacHex(secret, `${input.paymentId}|${input.subscriptionId}`), input.signature);
}

/** Webhook: HMAC-SHA256 of the exact raw request body with the webhook secret. */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string = razorpayWebhookSecret()) {
  return signaturesMatch(hmacHex(secret, rawBody), signature);
}

/** Sign a body the way Razorpay does. Used by tests and the local smoke check. */
export function signWebhookBody(rawBody: string, secret: string) {
  return hmacHex(secret, rawBody);
}

export function signCheckout(paymentId: string, subscriptionId: string, secret: string) {
  return hmacHex(secret, `${paymentId}|${subscriptionId}`);
}
