import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import styles from "./Dashboard.module.css";

const SNAPSHOTS = [
  { label: "Your workspace", value: "Ready to begin", detail: "Clinical intake and 3D guidance" },
  { label: "Safety engine", value: "Active", detail: "Deterministic rules are enforced" },
  { label: "Saved plans", value: "None yet", detail: "Plans will appear here after review" },
];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?from=/dashboard");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.greeting}>Good to see you, {user.name.split(" ")[0]}.</p>
          <h1 className={styles.title}>Your rehabilitation workspace.</h1>
          <p className={styles.email}>{user.email}</p>
        </div>
        <span className={styles.roleBadge}>{user.role}</span>
      </header>

      <div className={styles.grid}>
        <section className={styles.heroCard}>
          <div className={styles.heroCardCopy}>
            <p className={styles.cardLabel}>Start with the patient story</p>
            <h2 className={styles.cardTitle}>Make the next movement easier to see.</h2>
            <p className={styles.cardBody}>
              Bring a report into the intake flow, complete the red-flag screen,
              then use the 3D body to guide a safer rehabilitation conversation.
            </p>
            <Link href="/workspace" className={styles.action}>
              Open workspace
            </Link>
          </div>
          <div className={styles.heroCardVisual} aria-hidden="true">
            <span className={styles.visualRing} />
            <span className={styles.visualBody} />
            <span className={styles.visualDot} />
            <span className={styles.visualLabel}>3D body / live view</span>
          </div>
        </section>

        <section className={styles.snapshotSection} aria-labelledby="workspace-snapshot">
          <div className={styles.sectionHeading}>
            <p className={styles.cardLabel}>Workspace snapshot</p>
            <h2 id="workspace-snapshot">Everything in one view.</h2>
          </div>
          <div className={styles.snapshots}>
            {SNAPSHOTS.map((snapshot) => (
              <div key={snapshot.label} className={styles.snapshot}>
                <span className={styles.statLabel}>{snapshot.label}</span>
                <strong className={styles.statValue}>{snapshot.value}</strong>
                <span className={styles.statDetail}>{snapshot.detail}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.nextSection}>
          <div>
            <p className={styles.cardLabel}>Designed for understanding</p>
            <h2 className={styles.nextTitle}>Anatomy, movement, and guidance—together.</h2>
          </div>
          <p className={styles.cardBody}>
            SomaCue is being built as a shared visual language for physiotherapy:
            a place to explore, explain, and keep the plan grounded in the body.
          </p>
        </section>
      </div>
    </main>
  );
}
