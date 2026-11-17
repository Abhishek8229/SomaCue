"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { Bar, Button, Check, Segmented, Stage, Window, type Act } from "./kit";
import { ConditionCard } from "@/components/workspace/ConditionCard";
import { SetRepCounter } from "@/components/workspace/SetRepCounter";
import type { DetectedCondition } from "@/lib/clinical/assessment";
import styles from "./hero-stage.module.css";

/**
 * The hero walkthrough: one scripted intake in a faux workspace window.
 * Imaging goes in, the no-prescription gate is acknowledged, the source
 * attributed ConditionCard arrives, and the Supine Pelvic Tilt stage unlocks.
 */

type Phase = "intake" | "wait" | "result" | "stage";

type S = {
  imaging: "none" | "uploading" | "done";
  ack: boolean;
  phase: Phase;
  playing: boolean;
  pose: 0 | 1;
  caption: "" | "Move" | "Hold" | "Return";
  rep: number;
  speed: 0.5 | 1;
};

const initial: S = {
  imaging: "none",
  ack: false,
  phase: "intake",
  playing: false,
  pose: 0,
  caption: "",
  rep: 0,
  speed: 1,
};

const POSTER: S = {
  imaging: "done",
  ack: true,
  phase: "stage",
  playing: true,
  pose: 1,
  caption: "Hold",
  rep: 4,
  speed: 0.5,
};

const CONDITION: DetectedCondition = {
  title: "Likely lower lumbar disc bulge",
  summary:
    "Scans and symptoms point to a bulging disc in the lower lumbar spine.",
  source: "scans_and_symptoms",
  requiresInPersonCare: false,
  careReason: null,
};

async function script(a: Act<S>) {
  await a.wait(600);

  // 1. Imaging goes into its own slot.
  await a.move("browse");
  await a.wait(200);
  await a.click();
  await a.set({ imaging: "uploading" });
  await a.wait(800);
  await a.set({ imaging: "done" });
  await a.wait(500);

  // 2. No prescription, so the acknowledgment gate has to be ticked.
  await a.move("ack");
  await a.wait(200);
  await a.click();
  await a.set({ ack: true });
  await a.wait(500);

  // 3. Start the diagnostic; the attributed condition arrives.
  await a.move("start");
  await a.wait(200);
  await a.click();
  await a.set({ phase: "wait" });
  await a.wait(1500);
  await a.set({ phase: "result" });
  await a.wait(2800);

  // 4. The movement stage unlocks; play, then slow the pace.
  await a.set({ phase: "stage" });
  await a.wait(800);
  await a.move("play");
  await a.wait(200);
  await a.click();
  await a.set({ playing: true });

  for (let rep = 1; rep <= 4; rep++) {
    const scale = rep >= 3 ? 1.8 : 1;
    await a.set({ caption: "Move", pose: 1 });
    await a.wait(520 * scale);
    await a.set({ caption: "Hold" });
    await a.wait(520 * scale);
    await a.set({ caption: "Return", pose: 0 });
    await a.wait(420 * scale);
    await a.set({ rep });
    if (rep === 2) {
      await a.move("speed-half");
      await a.wait(150);
      await a.click();
      await a.set({ speed: 0.5 });
    }
  }
  await a.set({ caption: "Hold", pose: 1 });
  await a.wait(2400);

  await a.set({ ...initial });
  await a.wait(600);
}

function Frames({ pose }: { pose: 0 | 1 }) {
  return (
    <div className={styles.frames}>
      <Image
        alt="Figure lying on its back, knees bent, lower back resting on the floor"
        className={styles.frame}
        data-on={pose === 0}
        fill
        sizes="640px"
        src="/landing/pelvic-rest.webp"
      />
      <Image
        alt="Figure lying on its back with the pelvis tilted and the lower back flattened"
        className={styles.frame}
        data-on={pose === 1}
        fill
        sizes="640px"
        src="/landing/pelvic-hold.webp"
      />
    </div>
  );
}

function StagePanel({ s, locked }: { s: S; locked: boolean }) {
  return (
    <section className={styles.stagePanel} aria-label="3D movement stage">
      <div className={styles.stageTop}>
        <span className={styles.live}>{s.playing ? "live motion" : "live stage"}</span>
        <span className={styles.muted}>Lying on the back, side view</span>
      </div>
      <Frames pose={s.pose} />
      <div className={styles.caption} data-show={s.playing && s.caption !== ""}>
        {s.caption || "Move"}
      </div>
      <div className={styles.stageFoot}>
        <div>
          <p className={styles.exercise}>Supine Pelvic Tilt</p>
          <SetRepCounter
            celebration={null}
            progress={{ set: 1, setsDone: 0, repsDoneInSet: s.rep, allDone: false }}
            reducedMotion
            reps={10}
            sets={1}
          />
        </div>
        <div className={styles.controls}>
          <Segmented
            data-target="speed"
            items={["0.5x", "1.0x"]}
            targets={["speed-half", "speed-full"]}
            value={s.speed === 0.5 ? 0 : 1}
          />
          <Button data-target="play" size="large" variant="primary">
            {s.playing ? "Pause" : "Play"}
          </Button>
        </div>
      </div>
      <div className={styles.lock} data-show={locked}>
        <p className={styles.lockTitle}>3D stage locked</p>
        <p className={styles.lockBody}>Finish the triage questions to unlock your movement plan.</p>
      </div>
    </section>
  );
}

function IntakePanel({ s }: { s: S }) {
  const waiting = s.phase === "wait";
  return (
    <div className={styles.intake}>
      <div className={styles.zone}>
        <p className={styles.zoneTitle}>Medical scans / imaging</p>
        <div className={styles.zoneBody}>
          <span className={styles.browse} data-show={s.imaging === "none"} data-target="browse" data-cursor="pointer">
            Browse
          </span>
          <span className={styles.file} data-show={s.imaging !== "none"}>
            <Check on={s.imaging === "done"} pending={s.imaging === "uploading"} size={14} />
            lumbar-mri.pdf
          </span>
        </div>
      </div>
      <div className={styles.zone}>
        <p className={styles.zoneTitle}>Clinical prescriptions &amp; notes</p>
        <div className={styles.zoneBody}>
          <Bar w={96} h={6} tone={2} />
        </div>
      </div>
      <div className={styles.ack} data-target="ack" data-cursor="pointer">
        <Check on={s.ack} size={16} />
        <p>I have no prescription</p>
      </div>
      <Button data-target="start" size="large" variant="primary" className={styles.start}>
        {waiting ? "Reading your intake" : "Start diagnostic"}
      </Button>
    </div>
  );
}

const subscribe = () => () => {};
const OFF = { opacity: 0, transform: "translateY(8px)", pointerEvents: "none" } as const;

export function HeroStage() {
  // False on the server and during hydration, so the page is complete without scripting.
  const armed = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <div
      className={armed ? `${styles.host} js` : styles.host}
      aria-hidden="true"
    >
      <Stage<S>
        width={880}
        height={560}
        compact={{ below: 600, width: 358, height: 520 }}
        fill
        theme="dark"
        initial={initial}
        poster={POSTER}
        script={script}
        cursor={{ at: { wide: { x: 700, y: 120 }, compact: { x: 280, y: 90 } }, ripple: true }}
        tokens={{
          "--ss-canvas": "var(--workspace-canvas)",
          "--ss-surface": "var(--workspace-panel)",
          "--ss-chrome": "var(--workspace-header)",
          "--ss-well": "var(--workspace-well)",
          "--ss-raised": "var(--workspace-panel-raised)",
          "--ss-line": "var(--workspace-rule)",
          "--ss-text-strong": "var(--stage-ink)",
          "--ss-text": "var(--stage-ink-2)",
          "--ss-text-faint": "var(--stage-muted)",
          "--ss-accent": "var(--stage-accent)",
          "--ss-font": "var(--font-body)",
          "--ss-radius-md": "6px",
        }}
        className={styles.stage}
      >
        {(s, _rect, layout) => {
          const compact = layout === "compact";
          const showIntake = s.phase === "intake" || s.phase === "wait";
          return (
            <Window title="SomaCue Rehab Studio" className={styles.window} body={{ className: styles.body }}>
              <div className={styles.grid} data-layout={layout}>
                <div className={styles.rail}>
                  <div className={styles.layer} style={showIntake ? undefined : OFF}>
                    <IntakePanel s={s} />
                  </div>
                  {armed ? (
                    <div
                      className={`${styles.layer} ${styles.cardLayer} workspace-shell`}
                      style={(compact ? s.phase === "result" : !showIntake) ? undefined : OFF}
                    >
                      <ConditionCard condition={CONDITION} escalation={null} />
                    </div>
                  ) : null}
                </div>
                <div className={styles.center} style={compact && s.phase !== "stage" ? { opacity: 0, pointerEvents: "none" } : undefined}>
                  <StagePanel s={s} locked={s.phase !== "stage"} />
                </div>
              </div>
            </Window>
          );
        }}
      </Stage>
    </div>
  );
}
