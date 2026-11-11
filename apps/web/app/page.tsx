import Link from "next/link";
import styles from "./Home.module.css";

const CAPABILITIES = [
  {
    index: "01",
    title: "Explore anatomy",
    body: "Select a region, reveal the structures beneath it, and build a visual understanding of how the body moves.",
  },
  {
    index: "02",
    title: "See movement",
    body: "Pair each exercise with a smooth 3D demonstration that keeps the relevant joints and muscles in view.",
  },
  {
    index: "03",
    title: "Guide with confidence",
    body: "Turn clinical context into a focused, reviewable plan with safety rules that stay deterministic.",
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.heroLabel}>A clearer way to move</p>
          <h1 className={styles.headline}>Make the body understandable.</h1>
          <p className={styles.lede}>
            SomaCue brings anatomy, movement, and clinical safety into one
            interactive 3D workspace for better rehabilitation conversations.
          </p>
          <div className={styles.heroActions}>
            <Link href="/register" className={styles.primaryAction}>
              Start exploring
            </Link>
          </div>
          <div className={styles.heroNotes} aria-label="SomaCue focus areas">
            <span>Human anatomy</span>
            <span>Guided movement</span>
            <span>Safety first</span>
          </div>
        </div>

        <div className={styles.viewport} aria-label="SomaCue 3D anatomy workspace preview">
          <div className={styles.viewportTop}>
            <span className={styles.viewportTitle}>Anatomy workspace</span>
            <span className={styles.liveState}>
              <span aria-hidden="true" />
              Ready to explore
            </span>
          </div>
          <div className={styles.viewportBody}>
            <div className={styles.bodyGrid} aria-hidden="true" />
            <div className={styles.bodyFigure} aria-hidden="true">
              <span className={styles.figureHead} />
              <span className={styles.figureNeck} />
              <span className={styles.figureTorso} />
              <span className={styles.figureArmLeft} />
              <span className={styles.figureArmRight} />
              <span className={styles.figureLegLeft} />
              <span className={styles.figureLegRight} />
              <span className={styles.figureHotspot} />
            </div>
            <div className={`${styles.callout} ${styles.calloutTop}`}>
              <span className={styles.calloutLine} />
              <span>
                <strong>Lumbar region</strong>
                selected area
              </span>
            </div>
            <div className={`${styles.callout} ${styles.calloutBottom}`}>
              <span>
                <strong>Movement view</strong>
                flexion · neutral
              </span>
            </div>
            <div className={styles.viewportControls}>
              <button type="button" aria-label="Front view" className={styles.controlActive}>
                Front
              </button>
              <button type="button" aria-label="Side view">Side</button>
              <button type="button" aria-label="Reset view">Reset</button>
            </div>
          </div>
          <div className={styles.viewportFooter}>
            <span>One body. Many ways to understand it.</span>
            <span className={styles.footerMarker}>01 / 03</span>
          </div>
        </div>
      </section>

      <section className={styles.intro}>
        <div className={styles.introLead}>
          <p className={styles.sectionLabel}>The SomaCue approach</p>
          <h2>Less guessing. More seeing.</h2>
        </div>
        <p className={styles.introBody}>
          Rehabilitation gets easier to explain when the patient can see what
          the clinician is describing. SomaCue turns an abstract body into a
          shared, navigable space.
        </p>
      </section>

      <section className={styles.capabilities} id="platform">
        <header className={styles.sectionHeader}>
          <p className={styles.sectionLabel}>Built around the body</p>
          <h2>One platform for the whole conversation.</h2>
        </header>

        <div className={styles.capabilityGrid}>
          {CAPABILITIES.map((capability) => (
            <article key={capability.title} className={styles.capability}>
              <span className={styles.capabilityIndex}>{capability.index}</span>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.workflow}>
        <div className={styles.workflowPanel}>
          <div className={styles.workflowCopy}>
            <p className={styles.sectionLabel}>A calmer clinical workflow</p>
            <h2>From report to movement in one place.</h2>
            <p>
              Start with the patient story, move through a guided safety screen,
              then use the 3D body to make the next step tangible.
            </p>
            <Link href="/workspace" className={styles.panelAction}>
              Open the workspace
            </Link>
          </div>
          <ol className={styles.workflowSteps}>
            <li>
              <span>01</span>
              <div>
                <strong>Understand</strong>
                <p>Bring the report and the patient context together.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Visualise</strong>
                <p>Use anatomy and movement to make the plan clear.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Guide</strong>
                <p>Keep exercise choices aligned with deterministic safety rules.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className={styles.finalCta}>
        <p className={styles.sectionLabel}>A more visual way to learn rehab</p>
        <h2>See the body. Explain the movement. Build trust.</h2>
        <Link href="/register" className={styles.primaryAction}>
          Create your workspace
        </Link>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.footerBrand}>SomaCue</Link>
        <span>Interactive anatomy for better rehabilitation.</span>
        <div className={styles.footerLinks}>
          <Link href="/login">Sign in</Link>
          <Link href="/register">Create account</Link>
        </div>
      </footer>
    </main>
  );
}
