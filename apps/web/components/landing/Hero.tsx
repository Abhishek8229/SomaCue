import Link from "next/link";
import { HeroStage } from "./HeroStage";
import styles from "./landing.module.css";

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.wrap}>
        <div className={styles.heroHead}>
          <h1 id="hero-title" className={styles.h1}>
            SomaCue — Bringing Physiotherapy to Life Through 3D.
          </h1>
          <div className={styles.heroSide}>
            <p className={styles.heroLead}>Triage with cited evidence, then a 3D body that shows each move.</p>
            <div className={styles.heroActions}>
              <Link className={styles.btnSolid} href="/register">
                Register
              </Link>
              <a className={styles.textLink} href="#intake">
                See how it works
              </a>
            </div>
          </div>
        </div>
        <div className={styles.heroStage}>
          <HeroStage />
        </div>
      </div>    </section>
  );
}
