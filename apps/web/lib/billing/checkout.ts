import { PRO_TIERS, type BillingStatus, type ProTier } from "./plans";

/*
 * Browser side of Razorpay Checkout. Call these from event handlers only: they
 * use window and document.
 *
 * The flow: POST /api/billing/checkout with the chosen tier -> open Checkout with the subscription
 * id -> on success POST /api/billing/verify. The server decides what the user gets; nothing
 * here unlocks Pro by itself.
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type CheckoutResponse = {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
};

type CheckoutInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: { error?: { description?: string } }) => void) => void;
};

type CheckoutConstructor = new (options: {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (response: CheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
}) => CheckoutInstance;

declare global {
  interface Window {
    Razorpay?: CheckoutConstructor;
  }
}

let scriptPromise: Promise<CheckoutConstructor> | null = null;

/** Loads Razorpay's Checkout script once. A failed load can be retried. */
export function loadRazorpayCheckout(): Promise<CheckoutConstructor> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout needs a browser."));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<CheckoutConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Checkout did not start.")));
    script.onerror = () => {
      script.remove();
      reject(new Error("Could not load the payment window. Check your connection and try again."));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

export type CheckoutOutcome =
  | { kind: "paid"; billing: BillingStatus }
  /** the user closed the payment window without paying */
  | { kind: "dismissed" }
  | { kind: "failed"; message: string };

type ApiFailure = { message?: string; error?: string };

async function postJson<T>(url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; data: ApiFailure }> {
  const response = await fetch(url, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, data: data as T } : { ok: false, status: response.status, data: data as ApiFailure };
}

export async function runProCheckout(user: { name?: string; email?: string }, tier: ProTier): Promise<CheckoutOutcome> {
  let subscribed: Awaited<ReturnType<typeof postJson<{ subscriptionId: string; keyId: string }>>>;
  try {
    subscribed = await postJson<{ subscriptionId: string; keyId: string }>("/api/billing/checkout", { tier });
  } catch {
    return { kind: "failed", message: "Could not reach the server. Check your connection and try again." };
  }
  if (!subscribed.ok) {
    return { kind: "failed", message: subscribed.data.message ?? "Could not start checkout. Please try again." };
  }

  let Checkout: CheckoutConstructor;
  try {
    Checkout = await loadRazorpayCheckout();
  } catch (error) {
    return { kind: "failed", message: error instanceof Error ? error.message : "Could not open the payment window." };
  }

  const paid = await new Promise<CheckoutResponse | "dismissed" | { failed: string }>((resolve) => {
    // A failed attempt keeps the window open so the user can try another method. If they
    // then close it, tell them why the last attempt failed instead of saying nothing.
    let lastFailure: string | null = null;
    const checkout = new Checkout({
      key: subscribed.data.keyId,
      subscription_id: subscribed.data.subscriptionId,
      name: "SomaCue",
      description: `SomaCue Pro, ${PRO_TIERS[tier].name} (${PRO_TIERS[tier].span})`,
      prefill: { name: user.name, email: user.email },
      theme: { color: "#34d399" },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => resolve(lastFailure ? { failed: lastFailure } : "dismissed") },
    });
    checkout.on("payment.failed", (response) => {
      lastFailure = response.error?.description ?? "The payment did not go through.";
    });
    checkout.open();
  });

  if (paid === "dismissed") return { kind: "dismissed" };
  if ("failed" in paid) return { kind: "failed", message: paid.failed };

  let verified: Awaited<ReturnType<typeof postJson<{ verified: boolean; billing: BillingStatus }>>>;
  try {
    verified = await postJson<{ verified: boolean; billing: BillingStatus }>("/api/billing/verify", paid);
  } catch {
    return {
      kind: "failed",
      message: "Your payment went through, but we could not confirm it yet. Refresh in a moment: Pro turns on as soon as it is confirmed.",
    };
  }
  if (!verified.ok) {
    return {
      kind: "failed",
      message:
        verified.data.message ??
        "Your payment could not be confirmed. If you were charged, it will unlock automatically or be refunded.",
    };
  }
  return { kind: "paid", billing: verified.data.billing };
}

export async function fetchBillingStatus(): Promise<BillingStatus | null> {
  try {
    const response = await fetch("/api/billing/status", { cache: "no-store" });
    return response.ok ? ((await response.json()) as BillingStatus) : null;
  } catch {
    return null;
  }
}
