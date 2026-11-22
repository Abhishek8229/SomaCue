import type { BillingStatus } from "./plans";

/* Browser side of promo codes: POST /api/billing/promo. The server decides what the user gets. */

export type PromoOutcome =
  | { kind: "ok"; billing: BillingStatus; expiresAt: string; durationDays: number }
  | { kind: "failed"; message: string };

const GENERIC_FAILURE = "Could not apply the promo code. Please try again.";

export async function redeemPromoCode(code: string): Promise<PromoOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/billing/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch {
    return { kind: "failed", message: "Could not reach the server. Check your connection and try again." };
  }

  const data = (await response.json().catch(() => null)) as {
    message?: unknown;
    billing?: BillingStatus;
    expiresAt?: unknown;
    durationDays?: unknown;
  } | null;

  if (!response.ok || !data?.billing || typeof data.expiresAt !== "string") {
    const message = typeof data?.message === "string" && data.message ? data.message : GENERIC_FAILURE;
    return { kind: "failed", message };
  }
  return {
    kind: "ok",
    billing: data.billing,
    expiresAt: data.expiresAt,
    durationDays: typeof data.durationDays === "number" ? data.durationDays : 60,
  };
}
