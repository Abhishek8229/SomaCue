"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { BillingStatus } from "@/lib/billing/plans";
import { redeemPromoCode } from "@/lib/billing/promoClient";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

export type PromoCodeCardProps = {
  /** called once the server has granted the plan */
  onApplied: (billing: BillingStatus, expiresAt: string) => void;
};

/** "Apply your promo code": 60 days of Pro with no payment. The server validates everything. */
export function PromoCodeCard({ onApplied }: PromoCodeCardProps) {
  const inputId = useId();
  const feedbackId = useId();
  const busy = useRef(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const trimmed = code.trim();

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy.current || !trimmed) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const outcome = await redeemPromoCode(trimmed);
      if (outcome.kind === "ok") {
        setCode("");
        setSuccess("Promo code applied. SomaCue Pro is active for 2 months.");
        onApplied(outcome.billing, outcome.expiresAt);
      } else {
        setError(outcome.message);
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/10 bg-zinc-950/60 p-4" data-testid="promo-code-card">
      <h3 className="text-sm font-semibold text-white">Apply your promo code</h3>
      <p className="mt-1 text-xs leading-relaxed text-white/60">Have a code? Redeem it for 2 months of SomaCue Pro.</p>
      <form className="mt-3 flex gap-2" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor={inputId}>
          Promo code
        </label>
        <input
          aria-describedby={error || success ? feedbackId : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="characters"
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-zinc-900 px-3 text-sm text-white outline-none placeholder:text-white/35 focus-visible:border-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-300/40"
          disabled={loading}
          id={inputId}
          maxLength={100}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Enter promo code"
          spellCheck={false}
          type="text"
          value={code}
        />
        <button
          className={`${interactive} min-h-11 shrink-0 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-zinc-950! hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={loading || !trimmed}
          type="submit"
        >
          {loading ? "Applying…" : "Apply"}
        </button>
      </form>
      {success ? (
        <p
          className="mt-3 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs leading-relaxed text-emerald-100"
          id={feedbackId}
          role="status"
        >
          {success}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-3 rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs leading-relaxed text-red-100"
          id={feedbackId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
