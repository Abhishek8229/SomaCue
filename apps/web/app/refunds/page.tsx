import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, legalStyles as styles } from "@/components/legal/LegalShell";
import { PRO_TIERS } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Cancellation and refund policy | SomaCue",
  description: "How SomaCue Pro access ends, and when we refund a payment.",
};

export default function RefundsPage() {
  return (
    <LegalShell
      lead="SomaCue Pro is a one-time payment for a fixed length of access, so there is nothing to cancel. This page explains how access ends and when a payment is refunded."
      title="Cancellation and refund policy"
    >
      <div className={styles.prose}>
        <h2>No automatic renewal</h2>
        <p>
          Each Pro purchase is paid once for 30, 60 or 90 days. It does not renew by itself, so you will not be charged again unless you choose
          to renew. When your days run out, your account returns to the Free plan and your saved information is kept. You can renew from
          Rehab Studio at any time; the new days are added after the ones you have left.
        </p>

        <h2>Refunds</h2>
        <p>
          SomaCue Pro costs {PRO_TIERS["1m"].label} for 30 days, {PRO_TIERS["2m"].label} for 60 days or {PRO_TIERS["3m"].label} for 90 days.
          Because Pro is available as soon as you pay, payments for access already in use are not refunded for the unused days. We do refund
          a payment in these cases:
        </p>
        <ul>
          <li>You were charged twice for the same purchase.</li>
          <li>Money was taken but Pro was not switched on, and we cannot switch it on for you.</li>
          <li>A charge you did not authorise.</li>
        </ul>
        <p>
          To ask for a refund, <Link href="/contact">contact us</Link> within 7 days of the charge with the email on your account and, if you
          have it, the payment reference from your receipt. We will reply within 3 working days.
        </p>

        <h2>How refunds are paid</h2>
        <p>
          An approved refund goes back to the payment method you used. Your bank or card issuer decides how long it then takes to show up,
          usually 5 to 7 working days.
        </p>

        <h2>Failed payments</h2>
        <p>
          If a payment fails, no Pro access is added and your account stays as it was. Nothing is lost. If money left your account but Pro did
          not switch on, it is switched on automatically once the payment is confirmed, or refunded.
        </p>

        <h2>Free plan</h2>
        <p>The Free plan costs nothing, so there is nothing to cancel or refund. You can stop using SomaCue at any time.</p>

        <p>
          Questions about a payment? See our <Link href="/contact">contact page</Link>, or read the <Link href="/terms">terms and conditions</Link>.
        </p>
      </div>
    </LegalShell>
  );
}
