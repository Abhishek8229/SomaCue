import Link from "next/link";
import { LEGAL_LINKS } from "@/lib/legal/business";
import styles from "./landing.module.css";

export function ClosingSection() {
  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <div className={styles.wrap}>
        <h2 id="closing-title" className={styles.closingTitle}>
          Start with an intake, not a guess.
        </h2>
        <div className={styles.closingActions}>
          <Link className={styles.btnSolid} href="/register">
            Register
          </Link>
          <Link className={styles.textLink} href="/login">
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`${styles.wrap} ${styles.footerInner}`}>
        <div>
          <Link className={styles.brand} href="/">
            <span className={styles.brandMark} aria-hidden="true">
              S
            </span>
            SomaCue
          </Link>
          <p className={styles.footerNote}>AI-assisted home rehab platform.</p>
        </div>
        <nav className={styles.footerLinks} aria-label="Footer">
          <a href="#intake">Intake</a>
          <a href="#triage">Triage</a>
          <a href="#guidance">3D guidance</a>
          <a href="#companion">Companion</a>
          <a href="#safety">Safety</a>
        </nav>
        <nav className={styles.footerLinks} aria-label="Account">
          <Link href="/login">Sign in</Link>
          <Link href="/register">Register</Link>
        </nav>
        <nav className={styles.footerLinks} aria-label="Legal">
          {LEGAL_LINKS.map((link) => (
            <Link href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
