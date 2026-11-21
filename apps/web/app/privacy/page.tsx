import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell, legalStyles as styles } from "@/components/legal/LegalShell";
import { operatorLine } from "@/lib/legal/business";

export const metadata: Metadata = {
  title: "Privacy policy | SomaCue",
  description: "What SomaCue collects, why, who processes it, and the choices you have.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      lead="SomaCue handles health information, so we keep what we collect to what the service needs and tell you plainly where it goes."
      title="Privacy policy"
    >
      <div className={styles.prose}>
        <p>
          This policy applies to {operatorLine()} (&ldquo;SomaCue&rdquo;, &ldquo;we&rdquo;). It explains what we collect, how we use it, who
          helps us process it, and the choices you have.
        </p>

        <h2>What we collect</h2>
        <h3>Account details</h3>
        <ul>
          <li>Your name, email address and role, and a hashed password (we never store your password itself).</li>
          <li>If you sign in with Google: your Google account identifier, name, email and profile picture.</li>
        </ul>
        <h3>Health information you give us</h3>
        <ul>
          <li>The symptoms you describe, and scans, reports or prescriptions you upload.</li>
          <li>Your answers to triage questions.</li>
          <li>The condition summary, exercise plan and schedule created for you.</li>
          <li>Your daily progress, feedback, and any Pain Override reports.</li>
          <li>Your messages with the Rehab Companion and its replies.</li>
        </ul>
        <h3>Billing information</h3>
        <ul>
          <li>
            Your plan, Pro access end date, the length you bought and the identifiers Razorpay gives us for your payment.{" "}
            <strong>We do not see or store your card, UPI or bank details.</strong> They are entered into Razorpay&rsquo;s secure payment
            window and handled by Razorpay.
          </li>
        </ul>
        <h3>Technical information</h3>
        <ul>
          <li>A sign-in cookie that keeps you signed in, and a setting in your browser that remembers your light or dark theme.</li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To provide SomaCue: summarise your condition, build and adapt your schedule, show movements, and answer your questions.</li>
          <li>To keep you safe: spot warning signs and lock exercises that need in-person care first.</li>
          <li>To run your account and billing, and to answer your requests.</li>
          <li>To keep the service secure and working.</li>
        </ul>
        <p>We do not sell your personal information, and we do not use it for third-party advertising.</p>

        <h2>Who processes it for us</h2>
        <p>We use trusted providers to run SomaCue. Each receives only what it needs for its job.</p>
        <ul>
          <li>
            <strong>An AI provider</strong>: your symptoms, uploaded reports and plan details are sent to an AI model to write the triage,
            plan and Rehab Companion replies.
          </li>
          <li>
            <strong>Razorpay</strong>: processes your payments under its own privacy policy.
          </li>
          <li>
            <strong>Cloud hosting and storage providers</strong>: host our database and the files you upload.
          </li>
          <li>
            <strong>Google</strong>: only if you choose to sign in with Google.
          </li>
        </ul>
        <p>We may also share information when the law requires it, or to protect someone&rsquo;s safety.</p>

        <h2>How long we keep it</h2>
        <p>
          We keep your account and health information while your account is open, so your plan and history are there when you return. If you
          ask us to delete your account, we remove your personal information, except billing records we must keep to meet legal and tax
          duties.
        </p>

        <h2>Your choices</h2>
        <ul>
          <li>You can ask to see, correct or delete the information we hold about you.</li>
          <li>Pro does not renew by itself, so there is no subscription to cancel.</li>
          <li>You can clear your Rehab Companion chat from the chat panel.</li>
        </ul>
        <p>
          To use any of these, <Link href="/contact">contact us</Link>.
        </p>

        <h2>Security</h2>
        <p>
          We protect your information with encrypted connections, hashed passwords and sign-in cookies that scripts cannot read. No online
          service can promise perfect security, so please use a strong, unique password.
        </p>

        <h2>Children</h2>
        <p>SomaCue is for people aged 18 and over. We do not knowingly collect information from children.</p>

        <h2>Changes to this policy</h2>
        <p>If we change this policy in a way that matters, we will tell you before it applies.</p>

        <h2>Contact</h2>
        <p>
          Questions about your privacy? See our <Link href="/contact">contact page</Link>.
        </p>
      </div>
    </LegalShell>
  );
}
