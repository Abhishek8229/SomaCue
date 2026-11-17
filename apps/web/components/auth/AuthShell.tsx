import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./auth.module.css";

type Mode = "login" | "register";

const COPY: Record<Mode, string> = {
  login: "Pick up your plan where you left it.",
  register: "Start with your scans and clinician notes.",
};

const STEPS = [
  { title: "Dual-track intake", note: "Scans and clinician notes go in separate slots." },
  { title: "Source-attributed triage", note: "Every assessment says what it was derived from." },
  { title: "3D guided rehab", note: "A figure performs each exercise, rep by rep." },
];

/** Keeps a safe ?next= when switching between the two pages. */
function withNext(path: string, next: string | null) {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

export function AuthShell({
  mode,
  next,
  children,
}: {
  mode: Mode;
  /** Already validated with safeNextPath, or null for the default destination. */
  next: string | null;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark} aria-hidden="true">
            S
          </span>
          SomaCue
        </Link>
        <nav className={styles.switch} aria-label="Account">
          <Link
            aria-current={mode === "login" ? "page" : undefined}
            className={styles.switchLink}
            href={withNext("/login", next)}
          >
            Sign in
          </Link>
          <Link
            aria-current={mode === "register" ? "page" : undefined}
            className={styles.switchLink}
            href={withNext("/register", next)}
          >
            Create account
          </Link>
        </nav>
      </header>

      <div className={styles.split}>
        <aside className={styles.showcase} aria-label="What SomaCue does">
          <h2 className={styles.lead}>{COPY[mode]}</h2>

          <figure className={styles.bench}>
            <Image
              alt="A 3D figure lying on its back performing the Supine Pelvic Tilt"
              className={styles.benchImage}
              height={357}
              priority
              src="/landing/pelvic-hold.webp"
              width={560}
            />
            <figcaption className={styles.benchCaption}>
              <span className={styles.benchName}>Supine Pelvic Tilt</span>
              <span className={styles.benchMeta}>0.5x and 1.0x pacing</span>
            </figcaption>
          </figure>

          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li className={styles.step} key={step.title}>
                <span className={styles.stepNum}>{index + 1}</span>
                <span>
                  <span className={styles.stepTitle}>{step.title}</span>
                  <span className={styles.stepNote}>{step.note}</span>
                </span>
              </li>
            ))}
          </ol>

          <p className={styles.safety}>
            Eight red-flag checks run before the AI. A match locks the Rehab Studio and points you to in-person care.
          </p>
          <p className={styles.status}>Prototype. Movement ranges are not clinically reviewed.</p>
        </aside>

        <main className={styles.formSide}>
          <div className={styles.formWrap}>{children}</div>
        </main>
      </div>
    </div>
  );
}
