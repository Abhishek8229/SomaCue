import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_LINKS, POLICIES_UPDATED } from "@/lib/legal/business";
import styles from "./legal.module.css";

/** The frame every public policy and pricing page shares: header, content and the legal footer. */
export function LegalShell({
  title,
  lead,
  showUpdated = true,
  children,
}: {
  title: string;
  lead?: string;
  /** pricing is not a policy, so it has no "last updated" line */
  showUpdated?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={`${styles.wrap} ${styles.headerInner}`}>
          <Link className={styles.brand} href="/">
            <span aria-hidden="true" className={styles.brandMark}>
              S
            </span>
            SomaCue
          </Link>
          <div className={styles.headerActions}>
            <Link className={styles.navLink} href="/pricing">
              Pricing
            </Link>
            <Link className={styles.navLink} href="/login">
              Sign in
            </Link>
            <Link className={styles.btn} href="/register">
              Register
            </Link>
          </div>
        </div>
      </header>

      <main className={`${styles.wrap} ${styles.main}`}>
        <h1 className={styles.title}>{title}</h1>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
        {showUpdated ? <p className={styles.updated}>Last updated {POLICIES_UPDATED}</p> : null}
        {children}
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <div>
            <Link className={styles.brand} href="/">
              <span aria-hidden="true" className={styles.brandMark}>
                S
              </span>
              SomaCue
            </Link>
            <p className={styles.footerNote}>AI-assisted home rehab platform. Educational guidance, not medical advice.</p>
          </div>
          <nav aria-label="Legal" className={styles.footerLinks}>
            {LEGAL_LINKS.map((link) => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export { styles as legalStyles };
