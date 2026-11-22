"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { PRO_TIERS, type BillingStatus, type ProTier, type UpgradeReason } from "@/lib/billing/plans";
import { ComparisonTable } from "./ComparisonTable";
import { FundingNote } from "./FundingNote";
import { PromoCodeCard } from "./PromoCodeCard";
import { formatBillingDate } from "./ManageSubscription";
import { TierSelector } from "./TierSelector";
import type { CheckoutPhase } from "./useBilling";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const COPY: Record<UpgradeReason, { title: string; reason: string }> = {
  reanalysis: {
    title: "Re-run your analysis with Pro",
    reason: "Your free plan includes one Discovery analysis. Pro lets you run a new one whenever your symptoms or scans change.",
  },
  schedule: {
    title: "Unlock your full schedule",
    reason: "Free covers Week 1 (Days 1–7). Pro opens your full adaptive schedule, from Day 1 to the end of your plan.",
  },
  companion: {
    title: "Keep talking with the Rehab Companion",
    reason:
      "Free includes up to 10 Rehab Companion messages during your first 7 days, 3 a day. Pro removes those limits for unlimited chat, with fair use applying.",
  },
  renew: {
    title: "Renew SomaCue Pro",
    reason: "Pick how many days to add. They start when your current access ends, so nothing you paid for is lost.",
  },
  general: {
    title: "Upgrade to SomaCue Pro",
    reason: "A full schedule, unlimited re-analysis and unlimited Rehab Companion chat. Pick the length that fits your plan.",
  },
};
export type UpgradeModalProps = {
  feature: UpgradeReason;
  phase: CheckoutPhase;
  error: string | null;
  tier: ProTier;
  /** the tier that covers the user's rehab plan, or null before they have an analysis */
  recommended: ProTier | null;
  /** ISO end of the Pro time the user already has, for renewing */
  accessEndsAt: string | null;
  onSelectTier: (tier: ProTier) => void;
  onUpgrade: () => void;
  onClose: () => void;
  /**
   * Shows "Apply your promo code" below the plan cards. Pass it only while the user has no active Pro plan; the modal
   * does not close itself, so the handler should close it.
   */
  onPromoApplied?: (billing: BillingStatus, expiresAt: string) => void;
};

export function UpgradeModal({
  feature,
  phase,
  error,
  tier,
  recommended,
  accessEndsAt,
  onSelectTier,
  onUpgrade,
  onClose,
  onPromoApplied,
}: UpgradeModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const copy = COPY[feature];
  const busy = phase !== "idle";
  const info = PRO_TIERS[tier];
  const renewing = feature === "renew";
  // Renewing means Pro is already active, and a code cannot be added to an active plan.
  const showPromo = Boolean(onPromoApplied) && !renewing;
  const endDate = formatBillingDate(accessEndsAt);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-zinc-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-xl rounded-2xl border border-emerald-300/25 bg-zinc-900 p-6 shadow-2xl shadow-black/60 outline-none"
        data-testid="upgrade-modal"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <p className="text-xs font-medium text-emerald-300">SomaCue Pro</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-white" id={titleId}>
          {copy.title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/70" id={descriptionId}>
          {copy.reason}
        </p>

        <FundingNote className="mt-4" />

        <ComparisonTable className="mt-5" compact />

        <TierSelector disabled={busy} name="upgrade-tier" onChange={onSelectTier} recommended={recommended} value={tier} />

        <p className="mt-3 text-xs leading-relaxed text-white/60">
          {renewing && endDate
            ? `Your Pro access ends on ${endDate}. The ${info.span} you pick are added after that date.`
            : `One payment of ${info.label} gives ${info.span} of Pro. It does not renew by itself.`}
        </p>

        {error ? (
          <p
            className="mt-3 rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs leading-relaxed text-red-100"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            className={`${interactive} min-h-11 rounded-lg bg-emerald-300 px-5 text-sm font-semibold text-zinc-950! hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60`}
            disabled={busy}
            onClick={onUpgrade}
            type="button"
          >
            {phase === "starting"
              ? "Opening secure checkout…"
              : `${renewing ? "Renew" : "Upgrade to Pro"} for ${info.name}, ${info.label}`}
          </button>
          <button
            className={`${interactive} min-h-11 rounded-lg border border-white/15 px-4 text-sm text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50`}
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Not now
          </button>
        </div>

        {showPromo && onPromoApplied ? (
          <div className="mt-5">
            <PromoCodeCard onApplied={onPromoApplied} />
          </div>
        ) : null}

        <p className="mt-4 text-[11px] leading-relaxed text-white/50">
          Secure payment by Razorpay. See the{" "}
          <Link className="underline hover:text-white" href="/pricing" target="_blank">
            pricing
          </Link>
          ,{" "}
          <Link className="underline hover:text-white" href="/terms" target="_blank">
            terms
          </Link>{" "}
          and{" "}
          <Link className="underline hover:text-white" href="/refunds" target="_blank">
            cancellation and refund policy
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
