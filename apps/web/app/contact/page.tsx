import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ContactReveal } from "@/components/legal/ContactReveal";
import { LegalShell, legalStyles as styles } from "@/components/legal/LegalShell";
import { BUSINESS } from "@/lib/legal/business";

export const metadata: Metadata = {
  title: "Contact us | SomaCue",
  description: "How to reach SomaCue about your account, billing, refunds or privacy.",
};

type Detail = { label: string; kind: string; weight: number; value: ReactNode };

export default function ContactPage() {
  // Email and phone render only a reveal button here. The values are read in the client
  // component, so they never appear in this page's HTML.
  const details: Detail[] = [];
  if (BUSINESS.legalName) details.push({ label: "Operated by", kind: "name", weight: 1, value: BUSINESS.legalName });
  if (BUSINESS.supportEmail) {
    details.push({ label: "Email", kind: "email", weight: 1.5, value: <ContactReveal kind="email" steps={1} /> });
  }
  if (BUSINESS.supportPhone) {
    details.push({ label: "Phone", kind: "phone", weight: 1, value: <ContactReveal kind="phone" steps={2} /> });
  }
  if (BUSINESS.address) details.push({ label: "Address", kind: "address", weight: 1.2, value: BUSINESS.address });
  const columns = details.map((item) => `${item.weight}fr`).join(" ");
  return (
    <LegalShell
      lead="For help with your account, a payment, a refund or your privacy, write to us. We reply within 3 working days."
      title="Contact us"
    >
      {details.length > 0 ? (
        <dl className={styles.contactGrid} style={{ "--cols": columns } as CSSProperties}>
          {details.map((item) => (
            <div className={styles.contactItem} data-kind={item.kind} key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={`${styles.missing} ${styles.prose}`} role="status">
          Our contact details have not been published yet.
        </p>
      )}

      <div className={styles.prose}>
        <h2>What to include</h2>
        <ul>
          <li>The email address on your SomaCue account.</li>
          <li>For a billing question, the date and amount of the payment and the payment reference from your receipt.</li>
          <li>Never send your card number, bank details or password.</li>
        </ul>

        <h2>Medical emergencies</h2>
        <p>
          We cannot respond to medical emergencies. If you have chest pain, difficulty breathing, sudden weakness, loss of bladder or bowel
          control, or any other emergency, contact your local emergency number or a doctor now.
        </p>

        <p>
          Also see the <Link href="/refunds">cancellation and refund policy</Link>, the <Link href="/privacy">privacy policy</Link> and the{" "}
          <Link href="/terms">terms and conditions</Link>.
        </p>
      </div>
    </LegalShell>
  );
}
