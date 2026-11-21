import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, legalStyles as styles } from "@/components/legal/LegalShell";
import { COMPANION_LIMITS, PLAN_LIMITS, PRO_TIERS } from "@/lib/billing/plans";
import { BUSINESS, operatorLine } from "@/lib/legal/business";

export const metadata: Metadata = {
  title: "Terms and conditions | SomaCue",
  description: "The terms for using SomaCue, including the medical disclaimer: SomaCue gives educational guidance and is not a clinical diagnosis.",
};

export default function TermsPage() {
  return (
    <LegalShell
      lead="These terms explain how you may use SomaCue and what you can expect from us. Please read them, and the medical disclaimer in particular, before you use the service."
      title="Terms and conditions"
    >
      <div className={styles.callout} role="note">
        <h2 id="medical-disclaimer">Medical disclaimer</h2>
        <p>
          <strong>SomaCue is educational guidance, not a clinical diagnosis.</strong> The condition summary, triage questions, exercise
          schedule, 3D movement demonstrations, joint-angle readouts and Rehab Companion answers are produced with the help of artificial
          intelligence and general reference information. They are not medical advice, a diagnosis, or a treatment plan prescribed for you by
          a clinician, and using SomaCue does not create a doctor and patient or physiotherapist and patient relationship.
        </p>
        <p>
          Speak to a qualified doctor or physiotherapist before you start any exercise, especially if you have a diagnosed condition, are
          recovering from surgery or injury, or are unsure whether an exercise is safe for you. Do not delay or ignore professional advice
          because of anything SomaCue shows you.
        </p>
        <p>
          <strong>Stop and use Pain Override</strong> if an exercise causes sharp pain, numbness, weakness or any new symptom. If you have
          chest pain, difficulty breathing, loss of bladder or bowel control, sudden weakness, or any other emergency, stop and contact your
          local emergency number or a doctor immediately. SomaCue cannot respond to emergencies.
        </p>
      </div>

      <div className={styles.prose}>
        <h2>1. Who we are</h2>
        <p>
          SomaCue is a home rehabilitation guidance service run by {operatorLine()} (&ldquo;SomaCue&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;). By creating an account or using the service you agree to these terms. If you do not agree, please do not use
          SomaCue.
        </p>
        {BUSINESS.legalName ? null : (
          <p className={styles.missing}>The registered name of the operator has not been published yet.</p>
        )}

        <h2>2. Your account</h2>
        <ul>
          <li>You must be 18 or older to create an account.</li>
          <li>Give accurate information and keep your sign-in details private. You are responsible for activity on your account.</li>
          <li>Tell us promptly if you think someone else has used your account.</li>
        </ul>

        <h2>3. What SomaCue does</h2>
        <p>
          You describe your symptoms and may upload scans or notes from a clinician. SomaCue uses AI to summarise a likely condition, ask
          follow-up questions, suggest a schedule of gentle exercises, and show each movement on a 3D body. Warning signs that need
          in-person care lock guided exercises until you have seen a professional. AI can be wrong or incomplete. Check anything important
          with a qualified professional.
        </p>

        <h2>4. Free and Pro plans</h2>
        <p>
          SomaCue is free to start. The Free plan includes {PLAN_LIMITS.free.analyses} Discovery analysis, the full 3D movement stage, Week 1 of your
          schedule (Days 1–{PLAN_LIMITS.free.scheduleDays}) and Rehab Companion messages: up to {COMPANION_LIMITS.perDay} in any 24 hours and {PLAN_LIMITS.free.companionMessages} in total, only during the{" "}
          {COMPANION_LIMITS.freeWindowDays} days after your plan is made. SomaCue Pro adds unlimited re-analysis, your full adaptive schedule from Day 1 to
          the full plan duration (at least 1 month), and unlimited Rehab Companion chat. Fair use applies to protect the service: up to{" "}
          {COMPANION_LIMITS.proPerWeek} messages in any rolling {COMPANION_LIMITS.freeWindowDays} days (168 hours). Pain Override, and
          the safe adjustment of your plan after a flare-up, are free on every plan. See the <Link href="/pricing">pricing page</Link> for details.
        </p>

        <h2>5. Payments, renewal and refunds</h2>
        <ul>
          <li>
            SomaCue Pro is sold as a fixed length of access, paid once in Indian rupees (INR): {PRO_TIERS["1m"].label} for 1 month (30 days),{" "}
            {PRO_TIERS["2m"].label} for 2 months (60 days) or {PRO_TIERS["3m"].label} for 3 months (90 days). Payments are processed by Razorpay.
          </li>
          <li>
            Pro does not renew by itself and we do not charge you again unless you choose to buy or renew. If you renew while you still have Pro,
            the new days are added after the ones you have left. When your days run out, your account returns to the Free plan and your saved
            information is kept.
          </li>
          <li>If a payment fails, no access is added. We may change prices for future purchases and will tell you first.</li>
          <li>
            Refunds are covered by the <Link href="/refunds">cancellation and refund policy</Link>.
          </li>
        </ul>

        <h2>6. Acceptable use</h2>
        <p>
          Do not misuse SomaCue. That includes trying to break or bypass its safety checks or plan limits, uploading files you do not have the
          right to share, using the service to give care to other people, or putting load on it that harms other users.
        </p>

        <h2>7. Your information</h2>
        <p>
          You keep ownership of what you upload. You allow us to process it to provide the service, as described in the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>

        <h2>8. Availability and changes</h2>
        <p>
          We work to keep SomaCue available but do not promise it will always be uninterrupted or error free. We may change or stop features,
          and we may update these terms. If a change matters, we will tell you before it applies. Using SomaCue after that means you accept
          the new terms.
        </p>

        <h2>9. Our responsibility</h2>
        <p>
          SomaCue is provided &ldquo;as is&rdquo; as a source of general educational guidance. To the extent the law allows, we are not
          liable for injury, loss or harm arising from how you use the guidance, or for indirect or consequential loss. Nothing in these terms
          limits any right you have under law that cannot be limited.
        </p>

        <h2>10. Governing law</h2>
        <p>These terms are governed by the laws of India. Courts in India have jurisdiction over any dispute about them.</p>

        <h2>11. Contact</h2>
        <p>
          Questions about these terms? See our <Link href="/contact">contact page</Link>.
        </p>
      </div>
    </LegalShell>
  );
}
