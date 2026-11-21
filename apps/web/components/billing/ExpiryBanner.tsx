"use client";

import { useSyncExternalStore } from "react";
import type { ExpiryNotice } from "@/lib/billing/plans";
import { formatBillingDate } from "./ManageSubscription";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

/*
 * "Dismissed for this session" lives in sessionStorage, read through useSyncExternalStore so the
 * server render and the first client render agree (the banner is hidden until hydration) and no
 * state is set from an effect.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readDismissed(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function dismiss(key: string) {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Private mode: the banner simply comes back on the next page load.
  }
  for (const listener of listeners) listener();
}

export const EXPIRY_BANNER_KEY = (kind: ExpiryNotice["kind"]) => `somacue.expiry-banner.${kind}`;

export type ExpiryBannerProps = {
  notice: ExpiryNotice;
  /** Free: opens the Upgrade dialog */
  onUpgrade: () => void;
  /** Pro: opens renewal */
  onRenew: () => void;
};

/** A translucent alert that the user's access to the daily schedule is about to end. */
export function ExpiryBanner({ notice, onUpgrade, onRenew }: ExpiryBannerProps) {
  const key = EXPIRY_BANNER_KEY(notice.kind);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(key),
    () => true,
  );
  if (dismissed) return null;

  const free = notice.kind === "free_week_ending";
  const endDate = notice.kind === "pro_expiring" ? formatBillingDate(notice.endsAt) : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-20 flex justify-center px-4 pt-3">
      <section
        aria-label={free ? "Free schedule access ending" : "Pro access ending"}
        className="pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-2xl border border-amber-300/35 bg-zinc-900/60 p-3.5 shadow-xl shadow-black/40 backdrop-blur-md backdrop-saturate-150"
        data-kind={notice.kind}
        data-testid="expiry-banner"
        role="status"
      >
        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-white">
            {free
              ? "Your free access to the daily schedule will expire soon — Upgrade to Pro to unlock your full recovery schedule"
              : "Your access to the daily schedule will expire soon — Renew your subscription to keep uninterrupted access"}
          </p>
          <p className="mt-1 text-[11px] text-white/60">
            {free
              ? `Free covers Days 1–7. ${notice.daysLeft} day${notice.daysLeft === 1 ? "" : "s"} left including today.`
              : `${notice.daysLeft} day${notice.daysLeft === 1 ? "" : "s"} left${endDate ? `, until ${endDate}` : ""}.`}
          </p>
          <button
            className={`${interactive} mt-2.5 min-h-9 rounded-lg bg-emerald-300 px-3.5 text-xs font-semibold text-zinc-950! hover:bg-emerald-200`}
            onClick={free ? onUpgrade : onRenew}
            type="button"
          >
            {free ? "Upgrade to Pro" : "Renew Subscription"}
          </button>
        </div>
        <button
          aria-label="Dismiss for this session"
          className={`${interactive} grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white`}
          onClick={() => dismiss(key)}
          type="button"
        >
          <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </button>
      </section>
    </div>
  );
}
