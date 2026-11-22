"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "@/components/legal/legal.module.css";
import { PRO_TIERS, type ProTier } from "@/lib/billing/plans";
import { FundingNote } from "./FundingNote";
import { TierSelector } from "./TierSelector";

export type PricingProCardProps = {
  /** the tier that covers the signed-in user's rehab plan, or null */
  recommended: ProTier | null;
  signedIn: boolean;
  isPro: boolean;
};

/** The Pro card on /pricing: a 1, 2 or 3 month choice, with the user's own plan preselected. */
export function PricingProCard({ recommended, signedIn, isPro }: PricingProCardProps) {
  const [tier, setTier] = useState<ProTier>(recommended ?? "1m");
  const info = PRO_TIERS[tier];
  const target = `/workspace?upgrade=${tier}`;
  const href = signedIn ? target : `/register?next=${encodeURIComponent(target)}`;

  return (
    <section aria-labelledby="plan-pro" className={`${styles.plan} ${styles.planPro}`} data-testid="pricing-pro-card">
      <h2 className={styles.planName} id="plan-pro">
        SomaCue Pro
      </h2>
      <p className={styles.price}>
        <span className={styles.priceAmount}>{info.label}</span>
        <span className={styles.priceNote}>
          for {info.name} ({info.span}), one payment in Indian rupees (INR)
        </span>
      </p>

      <TierSelector name="pricing-tier" onChange={setTier} recommended={recommended} value={tier} />

      <ul className={styles.features}>
        <li>Everything in Free</li>
        <li>Unlimited Discovery re-analysis</li>
        <li>Full adaptive schedule, Day 1 to the full plan duration (at least 1 month)</li>
        <li>Unlimited Rehab Companion chat (fair-use limits apply)</li>
      </ul>
      <FundingNote />
      <Link className={styles.btn} href={href}>
        {!signedIn
          ? "Register, then upgrade"
          : isPro
            ? `Renew for ${info.name}, ${info.label}`
            : `Upgrade for ${info.name}, ${info.label}`}
      </Link>
    </section>
  );
}
