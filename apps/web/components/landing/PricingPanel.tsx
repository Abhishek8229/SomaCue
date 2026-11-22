"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FundingNote } from "@/components/billing/FundingNote";
import { TierSelector } from "@/components/billing/TierSelector";
import { useBilling } from "@/components/billing/useBilling";
import { PRO_TIERS, usageSummary, type BillingStatus, type ProTier } from "@/lib/billing/plans";
import styles from "./sections.module.css";

/** What the hook needs when nobody is signed in: a Free user with nothing used. */
const LOGGED_OUT: BillingStatus = {
  plan: "free",
  status: null,
  currentPeriodEnd: null,
  tier: null,
  usage: usageSummary("free", { analyses: 0, companionMessages: 0 }),
};

export type PricingPanelProps = {
  /** null when the visitor is signed out */
  user: { name: string; email: string } | null;
  billing: BillingStatus | null;
  /** the tier that covers the signed-in user's rehab plan, if they have one */
  recommended: ProTier | null;
};

/**
 * The buying half of the landing page pricing section: the same tier choice and funding note as the
 * workspace upgrade dialog. A signed-out visitor goes to /register (and on to the chosen tier after
 * signing up); a signed-in one opens Razorpay Checkout right here.
 */
export function PricingPanel({ user, billing: initial, recommended }: PricingPanelProps) {
  const billingUser = useMemo(() => ({ name: user?.name, email: user?.email }), [user]);
  const billing = useBilling(initial ?? LOGGED_OUT, billingUser, recommended);
  const info = PRO_TIERS[billing.tier];
  const busy = billing.phase !== "idle";
  const signedIn = user !== null;
  const label = `Upgrade to Pro for ${info.name}, ${info.label}`;
  const registerHref = `/register?next=${encodeURIComponent(`/workspace?upgrade=${billing.tier}`)}`;

  return (
    <div className={styles.pricingPanel} data-testid="landing-pricing-panel">
      <h3 className={styles.h3}>SomaCue Pro</h3>
      <p className={styles.pricingPrice}>
        <span className={styles.pricingAmount}>{info.label}</span>
        <span className={styles.hint}>
          for {info.name} ({info.span}), one payment in INR
        </span>
      </p>

      <FundingNote className="mt-4" />

      <TierSelector
        disabled={busy}
        name="landing-tier"
        onChange={billing.selectTier}
        recommended={recommended}
        value={billing.tier}
      />

      {billing.isPro ? null : (
        <p className={styles.pricingMeta}>
          One payment of {info.label} gives {info.span} of Pro. It does not renew by itself.
        </p>
      )}

      {billing.error ? (
        <p className={styles.pricingError} role="alert">
          {billing.error}
        </p>
      ) : null}
      {billing.notice ? (
        <p className={styles.pricingOk} role="status">
          {billing.notice}
        </p>
      ) : null}

      {/* A user who already has Pro buys more days from Rehab Studio, so the buy block is only for everyone else. */}
      {billing.isPro ? null : (
        <>
          <div className={styles.pricingActions}>
            {signedIn ? (
              <button className={styles.btnSolid} disabled={busy} onClick={() => void billing.startCheckout()} type="button">
                {billing.phase === "starting" ? "Opening secure checkout…" : label}
              </button>
            ) : (
              <Link className={styles.btnSolid} href={registerHref}>
                {label}
              </Link>
            )}
            {signedIn ? (
              <Link className={styles.btnLine} href="/workspace">
                Open Rehab Studio
              </Link>
            ) : (
              <Link className={styles.btnLine} href="/register">
                Start free
              </Link>
            )}
          </div>

          <p className={styles.fine}>
            {signedIn ? "Secure payment by Razorpay. " : "You create a free account first, then pay. "}
            See the full{" "}
            <Link href="/pricing">pricing page</Link>, the <Link href="/terms">terms</Link> and the{" "}
            <Link href="/refunds">cancellation and refund policy</Link>.
          </p>
        </>
      )}
    </div>
  );
}
