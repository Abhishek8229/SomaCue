"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import styles from "./sections.module.css";

const LiveStage = dynamic(() => import("./LiveStage"), {
  ssr: false,
  loading: () => <p className={styles.liveLoading}>Loading the 3D body.</p>,
});

const FACTS = [
  { title: "Built live", body: "Each movement is solved on the body from a movement description, not played from a recorded clip." },
  { title: "Two paces", body: "Guided waits for each spoken cue before moving. Real-time moves continuously and stays silent." },
  { title: "Two views", body: "Anterior and posterior, or top and side for lying exercises, plus free orbit." },
];

export function GuidanceSection() {
  const anchor = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = anchor.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setNear(true));
      return () => cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section className={styles.section} id="guidance" aria-labelledby="guidance-title">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h2 id="guidance-title" className={styles.h2}>
            A 3D body performs today&apos;s exercise, rep by rep.
          </h2>
          <p className={styles.lead}>
            This is the Rehab Studio&apos;s 3D stage itself, running a reference exercise. Press play, switch the pace, change the
            view.
          </p>
        </header>

        <div className={styles.liveHost} ref={anchor}>
          {near ? <LiveStage /> : <p className={styles.liveLoading}>The 3D stage loads as you scroll here.</p>}
        </div>

        <dl className={styles.facts}>
          {FACTS.map((fact) => (
            <div className={styles.fact} key={fact.title}>
              <dt className={styles.h3}>{fact.title}</dt>
              <dd className={styles.hint}>{fact.body}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.fine}>
          No camera needed. SomaCue never watches you move.
        </p>
      </div>
    </section>
  );
}
