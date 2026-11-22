import Link from "next/link";
import styles from "./landing.module.css";
import { SectionLink } from "./SectionLink";

const ANCHORS: Array<{ href: string; label: string; highlight?: boolean }> = [
  { href: "#intake", label: "Intake" },
  { href: "#triage", label: "Triage" },
  { href: "#guidance", label: "3D guidance" },
  { href: "#companion", label: "Companion" },
  { href: "#safety", label: "Safety" },
  { href: "#pricing", label: "Pricing", highlight: true },
];

export function LandingNav() {
  return (
    <header className={styles.nav}>
      <div className={`${styles.wrap} ${styles.navInner}`}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark} aria-hidden="true">
            S
          </span>
          SomaCue
        </Link>
        <nav className={styles.anchors} aria-label="Sections">
          {ANCHORS.map((anchor) =>
            anchor.highlight ? (
              <SectionLink className={`${styles.anchor} ${styles.anchorHighlight}`} id={anchor.href.slice(1)} key={anchor.href}>
                {anchor.label}
              </SectionLink>
            ) : (
              <a className={styles.anchor} href={anchor.href} key={anchor.href}>
                {anchor.label}
              </a>
            ),
          )}
        </nav>
        <div className={styles.navActions}>
          <Link className={styles.anchor} href="/login">
            Sign in
          </Link>
          <Link className={styles.btnSolid} href="/register">
            Register
          </Link>
        </div>
      </div>
    </header>
  );
}
