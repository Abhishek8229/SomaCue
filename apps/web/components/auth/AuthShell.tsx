import Link from "next/link";
import { AuthStage } from "./AuthStage";
import { GoogleButton } from "./GoogleButton";
import styles from "./auth.module.css";

type Mode = "login" | "register";

const COPY: Record<
  Mode,
  { lead: string; sub: string; title: string; subtitle: string; assurances: string[]; switchText: string; switchLabel: string; switchPath: string }
> = {
  login: {
    lead: "Pick up your plan where you left it.",
    sub: "Your intake, triage and daily schedule are waiting in the Rehab Studio.",
    title: "Sign in",
    subtitle: "Continue to your Rehab Studio.",
    assurances: ["1-click sign-in. There is no password to remember.", "We use the name, Gmail address and photo on your Google account."],
    switchText: "New to SomaCue?",
    switchLabel: "Create an account",
    switchPath: "/register",
  },
  register: {
    lead: "Start with your scans and clinician notes.",
    sub: "Create your account in one click, then upload your intake and get a plan you can see.",
    title: "Create your account",
    subtitle: "Set up your Rehab Studio in seconds.",
    assurances: ["Instant account setup. No form to fill in and no password to create.", "We save the name, Gmail address and photo on your Google account."],
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchPath: "/login",
  },
};

const POINTS = [
  { title: "Source-attributed triage", note: "Every assessment says what it was derived from." },
  { title: "Joint angles, live", note: "Arcs and degrees follow the figure through each rep." },
  { title: "Red flags first", note: "Fixed safety checks run before the AI and point you to in-person care." },
];

/** Keeps a safe ?next= when switching between the two pages. */
function withNext(path: string, next: string | null) {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

function Tick() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 16 16" width="14">
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function AuthCard({ mode, next, error }: { mode: Mode; next: string | null; error: string | null }) {
  const copy = COPY[mode];
  return (
    <div className={styles.card} data-testid="auth-card">
      <header>
        <h1 className={styles.title}>{copy.title}</h1>
        <p className={styles.subtitle}>{copy.subtitle}</p>
      </header>

      {error ? (
        <div className={styles.banner} role="alert">
          {error}
        </div>
      ) : null}

      <GoogleButton next={next} />

      <ul className={styles.assure}>
        {copy.assurances.map((line) => (
          <li className={styles.assureItem} key={line}>
            <Tick />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className={styles.legal}>
        By continuing you agree to the <Link href="/terms">Terms and conditions</Link> and the{" "}
        <Link href="/privacy">Privacy policy</Link>.
      </p>

      <p className={styles.switchLine}>
        {copy.switchText}{" "}
        <Link className={styles.link} href={withNext(copy.switchPath, next)}>
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  );
}

export function AuthShell({
  mode,
  next,
  error,
}: {
  mode: Mode;
  /** Already validated with safeNextPath, or null for the default destination. */
  next: string | null;
  /** A message for a failed Google sign-in, from ?error= */
  error: string | null;
}) {
  const copy = COPY[mode];
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

      <main className={styles.main}>
        <section className={styles.cardCol} aria-label={copy.title}>
          <AuthCard error={error} mode={mode} next={next} />
        </section>

        <aside className={styles.showcase} aria-label="What SomaCue does">
          <h2 className={styles.lead}>{copy.lead}</h2>
          <p className={styles.leadSub}>{copy.sub}</p>
          <AuthStage />
          <ul className={styles.points}>
            {POINTS.map((point) => (
              <li className={styles.point} key={point.title}>
                <span className={styles.pointTitle}>{point.title}</span>
                <span className={styles.pointNote}>{point.note}</span>
              </li>
            ))}
          </ul>
        </aside>
      </main>
    </div>
  );
}
