import { ComparisonTable } from "@/components/billing/ComparisonTable";
import { getCurrentUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/entitlements";
import { getRecommendedTier } from "@/lib/billing/recommend";
import { PRO_TIERS } from "@/lib/billing/plans";
import { InitialHashScroll } from "./InitialHashScroll";
import { PricingPanel } from "./PricingPanel";
import styles from "./sections.module.css";

/** Pricing, after Safety. The prices and wording come from the same modules as the upgrade dialog and /pricing. */
export async function PricingSection() {
  const user = await getCurrentUser();
  const [billing, recommended] = user ? await Promise.all([getBillingStatus(user.id), getRecommendedTier(user.id)]) : [null, null];

  return (
    <section className={styles.section} id="pricing" aria-labelledby="pricing-title">
      <InitialHashScroll id="pricing" />
      <div className={styles.wrap} data-scroll-center>
        <header className={styles.head}>
          <h2 id="pricing-title" className={styles.h2}>
            Minimal pricing. Start free, add Pro for the whole plan.
          </h2>
          <p className={styles.lead}>
            One payment buys {PRO_TIERS["1m"].span}, {PRO_TIERS["2m"].span} or {PRO_TIERS["3m"].span} of Pro. It never renews by itself.
          </p>
        </header>

        <div className={styles.pricingGrid}>
          <div className={styles.pricingCompare}>
            <h3 className={styles.h3}>Free and Pro</h3>
            <ComparisonTable className="mt-4" />
          </div>
          <PricingPanel
            billing={billing}
            recommended={recommended}
            user={user ? { name: user.name, email: user.email } : null}
          />
        </div>
      </div>
    </section>
  );
}
