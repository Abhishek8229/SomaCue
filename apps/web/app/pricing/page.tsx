import type { Metadata } from "next";
import Link from "next/link";
import { PricingProCard } from "@/components/billing/PricingProCard";
import { LegalShell, legalStyles as styles } from "@/components/legal/LegalShell";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPlan } from "@/lib/billing/entitlements";
import { COMPARISON_ROWS } from "@/lib/billing/copy";
import { COMPANION_LIMITS, PLAN_LIMITS, PRO_TIERS } from "@/lib/billing/plans";
import { getRecommendedTier } from "@/lib/billing/recommend";

export const metadata: Metadata = {
  title: "Pricing | SomaCue",
  description: `SomaCue is free to start. SomaCue Pro costs ${PRO_TIERS["1m"].label} for 30 days, ${PRO_TIERS["2m"].label} for 60 days or ${PRO_TIERS["3m"].label} for 90 days, and adds unlimited re-analysis, your full adaptive schedule and unlimited Rehab Companion chat.`,
};

export default async function PricingPage() {
  const user = await getCurrentUser();
  const [recommended, plan] = user ? await Promise.all([getRecommendedTier(user.id), getUserPlan(user.id)]) : [null, "free" as const];

  return (
    <LegalShell
      lead="Start free with a full 3D movement stage. Upgrade when you want your whole plan and more support."
      showUpdated={false}
      title="Simple pricing"
    >
      <div className={styles.plans}>
        <section aria-labelledby="plan-free" className={styles.plan}>
          <h2 className={styles.planName} id="plan-free">
            Free
          </h2>
          <p className={styles.price}>
            <span className={styles.priceAmount}>₹0</span>
            <span className={styles.priceNote}>always</span>
          </p>
          <ul className={styles.features}>
            <li>One Discovery triage analysis</li>
            <li>The full 3D kinematic movement stage, with all controls</li>
            <li>Week 1 of your generated schedule (Days 1–{PLAN_LIMITS.free.scheduleDays})</li>
            <li>
              Rehab Companion: up to {COMPANION_LIMITS.perDay} messages a day, {PLAN_LIMITS.free.companionMessages} in total during your first{" "}
              {COMPANION_LIMITS.freeWindowDays} days
            </li>
            <li>Pain Override and safe plan adjustment after a flare-up, free on every plan</li>
          </ul>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/register">
            Start free
          </Link>
        </section>

        <PricingProCard isPro={plan === "pro"} recommended={recommended} signedIn={user !== null} />
      </div>

      <p className={styles.fineprint}>
        Rehab Companion limits: Free allows {COMPANION_LIMITS.perDay} messages in any 24 hours and {COMPANION_LIMITS.freeTotal} in total, during the{" "}
        {COMPANION_LIMITS.freeWindowDays} days after your plan is made. Pro chat is unlimited in practice: to keep the service reliable for everyone, a fair-use limit of{" "}
        {COMPANION_LIMITS.proPerWeek} messages in any {COMPANION_LIMITS.freeWindowDays} days applies. When you reach a limit, the Companion tells you when it opens again.
      </p>

      <table className={styles.compare}>
        <caption>Compare plans</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className={styles.srOnly}>Feature</span>
            </th>
            <th scope="col">Free</th>
            <th scope="col">Pro</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.feature}>
              <th scope="row">{row.feature}</th>
              <td>{row.free}</td>
              <td className={styles.proCell}>{row.pro}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.prose}>
        <h2>How billing works</h2>
        <ul>
          <li>
            SomaCue Pro is sold as a fixed length of access, paid once in Indian rupees (INR): {PRO_TIERS["1m"].label} for 1 month (30 days),{" "}
            {PRO_TIERS["2m"].label} for 2 months (60 days) or {PRO_TIERS["3m"].label} for 3 months (90 days). The 2 and 3 month options are
            discounted bundles.
          </li>
          <li>
            After you finish your analysis we preselect the length that covers your rehab plan. You can choose a longer one at the bundle price
            whatever your plan length is.
          </li>
          <li>Pro does not renew by itself. You are charged only when you choose to buy or renew, and renewing adds days after the ones you have left.</li>
          <li>Payments are processed securely by Razorpay. SomaCue never sees or stores your card or bank details.</li>
          <li>Pain Override, and the safe adjustment of your plan after a flare-up, are free on every plan.</li>
        </ul>
        <p>
          Read the <Link href="/refunds">cancellation and refund policy</Link> and the <Link href="/terms">terms and conditions</Link>, or{" "}
          <Link href="/contact">contact us</Link> with any question about billing.
        </p>
        <p>
          SomaCue gives educational exercise guidance. It is not a medical diagnosis or treatment, and Pro does not change that.
        </p>
      </div>
    </LegalShell>
  );
}
