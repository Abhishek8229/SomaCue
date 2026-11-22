import { BillingConfigError, RazorpayError } from "./razorpay";

/** JSON that is never cached: these answers are per user and change with payments. */
export function billingJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Turns a failure into a response without leaking internals. A missing setting is a
 * 503 (billing is switched off, nothing the user can fix); a Razorpay failure is a
 * 502 and keeps Razorpay's own short description only when `relayRazorpay` is set.
 */
export function billingFailure(error: unknown, context: string, options: { relayRazorpay?: boolean } = {}) {
  if (error instanceof BillingConfigError) {
    console.error(`[SomaCue billing] ${context}: ${error.message}`);
    return billingJson({ error: "BILLING_UNAVAILABLE", message: "Billing is not available right now. Please try again later." }, 503);
  }
  if (error instanceof RazorpayError) {
    console.error(`[SomaCue billing] ${context}: Razorpay ${error.status} ${error.code ?? ""} ${error.message}`);
    return billingJson(
      {
        error: "PAYMENT_PROVIDER_ERROR",
        message: options.relayRazorpay ? error.message : "The payment provider could not complete that. Please try again.",
      },
      502,
    );
  }
  console.error(`[SomaCue billing] ${context} failed.`, error instanceof Error ? error.message : error);
  return billingJson({ error: "BILLING_FAILED", message: "Something went wrong. Please try again." }, 500);
}
