"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { PLAN_LIMITS, PRO_DAY_MS, PRO_TIERS, type BillingStatus } from "@/lib/billing/plans";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function formatBillingDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export type ManageSubscriptionProps = {
  billing: BillingStatus;
  error: string | null;
  notice: string | null;
  /** Pro user adds more days after the ones they have */
  onRenew: () => void;
  /** Free user starts Pro */
  onUpgrade: () => void;
  onClose: () => void;
};

export function ManageSubscription({ billing, error, notice, onRenew, onUpgrade, onClose }: ManageSubscriptionProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const isPro = billing.plan === "pro";
  const endDate = formatBillingDate(billing.currentPeriodEnd);
  // Read once when the panel opens: "days left" does not need to tick while it is open.
  const [openedAt] = useState(() => Date.now());
  const daysLeft = billing.currentPeriodEnd
    ? Math.max(0, Math.ceil((new Date(billing.currentPeriodEnd).getTime() - openedAt) / PRO_DAY_MS))
    : null;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
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

  const { usage } = billing;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-zinc-950/70 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex h-full w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-emerald-300/20 bg-zinc-900 p-6 outline-none"
        data-testid="manage-subscription"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-emerald-300">Billing</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-white" id={titleId}>
              Your plan
            </h2>
          </div>
          <button
            aria-label="Close"
            className={`${interactive} grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white`}
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </button>
        </div>

        <section className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
          <p className="text-[11px] text-white/50">Current plan</p>
          <p className="mt-1 flex items-center gap-2 text-base font-semibold text-white">
            {isPro ? "SomaCue Pro" : "Free"}
            {isPro ? (
              <span className="rounded-full border border-emerald-300/40 bg-emerald-300/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                Active
              </span>
            ) : null}
          </p>

          {isPro ? (
            <>
              <p className="mt-2 text-xs leading-relaxed text-white/70">
                {endDate
                  ? `Pro access until ${endDate}${daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}.`
                  : "Pro access is active."}{" "}
                {billing.tier ? `Your last purchase was ${PRO_TIERS[billing.tier].name} (${PRO_TIERS[billing.tier].label}). ` : ""}
                Pro does not renew by itself, so you are never charged again unless you choose to renew.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-white/70" data-testid="pro-companion-line">
                Rehab Companion: unlimited chat (fair-use limits apply).
              </p>
            </>
          ) : (
            <ul className="mt-3 space-y-1.5 text-xs text-white/70">
              <li>
                Discovery analyses: {usage.analysesUsed} of {PLAN_LIMITS.free.analyses} used
              </li>
              <li>Schedule: Week 1 only (Days 1–{PLAN_LIMITS.free.scheduleDays})</li>
              <li>
                Rehab Companion: {usage.companionMessagesUsed} of {PLAN_LIMITS.free.companionMessages} messages used (3 a day)
              </li>
            </ul>
          )}
        </section>

        {notice ? (
          <p className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-xs leading-relaxed text-emerald-100" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs leading-relaxed text-red-100" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className={`${interactive} min-h-11 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-zinc-950! hover:bg-emerald-200`}
          onClick={isPro ? onRenew : onUpgrade}
          type="button"
        >
          {isPro ? "Renew Subscription" : "Upgrade to Pro"}
        </button>

        <p className="mt-auto text-[11px] leading-relaxed text-white/45">
          Payments are handled by Razorpay. Read the{" "}
          <Link className="underline hover:text-white" href="/refunds" target="_blank">
            cancellation and refund policy
          </Link>{" "}
          or{" "}
          <Link className="underline hover:text-white" href="/contact" target="_blank">
            contact us
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}
