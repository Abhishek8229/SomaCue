"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/use-environment";
import styles from "./auth.module.css";

// The same live CC4 figure the landing hero and the Rehab Studio stage use: anatomical shading,
// the movement solver and the joint-angle arcs and pills. Loaded only in the browser.
const HeroFigure = dynamic(() => import("@/components/landing/HeroFigure"), { ssr: false });

type Pose = 0 | 1;
type Caption = "Move" | "Hold" | "Return";
type Speed = 0.5 | 1;

const REPS = 10;
const EXERCISE = "Supine Pelvic Tilt";

/** The three beats of one rep, in milliseconds at 1.0x. Half speed stretches each by 1.8, as on the landing page. */
const BEATS: ReadonlyArray<{ caption: Caption; pose: Pose; ms: number }> = [
  { caption: "Move", pose: 1, ms: 520 },
  { caption: "Hold", pose: 1, ms: 520 },
  { caption: "Return", pose: 0, ms: 420 },
];

/** How long the figure takes to ease between poses; shorter than the shortest beat so every rep settles. */
const transitionMs = (speed: Speed) => (speed === 0.5 ? 720 : 400);

const subscribe = () => () => {};

/**
 * The live 3D movement stage shown beside the sign-in card: the exercise plays rep by rep with the
 * joint angles drawn on the figure, and the visitor can slow it to half speed or pause it.
 */
export function AuthStage() {
  // False on the server and during hydration, so the page is complete without scripting.
  const armed = useSyncExternalStore(subscribe, () => true, () => false);
  const webgl = useWebGLSupport();
  const reducedMotion = usePrefersReducedMotion();
  const [figure, setFigure] = useState<"loading" | "ready" | "failed">("loading");
  const [pose, setPose] = useState<Pose>(1);
  const [caption, setCaption] = useState<Caption>("Hold");
  const [rep, setRep] = useState(0);
  const [speed, setSpeed] = useState<Speed>(1);
  const [paused, setPaused] = useState(false);

  const handleReady = useCallback(() => setFigure("ready"), []);
  const handleError = useCallback(() => setFigure("failed"), []);

  const live = armed && webgl === "available" && figure !== "failed";
  const playing = armed && !paused && !reducedMotion;

  // One rep at a time: Move, Hold, Return, then count it. State is set from the timer's callback.
  useEffect(() => {
    if (!playing) return;
    const scale = speed === 0.5 ? 1.8 : 1;
    let beat = 0;
    let timer = 0;
    const step = () => {
      const current = BEATS[beat];
      setCaption(current.caption);
      setPose(current.pose);
      timer = window.setTimeout(() => {
        if (beat === BEATS.length - 1) setRep((done) => (done >= REPS ? 1 : done + 1));
        beat = (beat + 1) % BEATS.length;
        step();
      }, current.ms * scale);
    };
    timer = window.setTimeout(step, 0);
    return () => window.clearTimeout(timer);
  }, [playing, speed]);

  const showHold = !playing; // paused, reduced motion or not yet armed: the held tilt, which shows the angles best

  return (
    <section className={styles.stage} aria-label="Live 3D movement stage">
      <div className={styles.stageTop}>
        <span className={styles.stageLive}>{playing ? "live motion" : "live stage"}</span>
        <span className={styles.stageView}>Lying on the back, side view</span>
      </div>

      <div className={styles.stageBody} aria-hidden="true">
        <div className={styles.frames} data-hidden={live && figure === "ready"}>
          <Image
            alt=""
            className={styles.frame}
            data-on={(showHold ? 1 : pose) === 0}
            fill
            priority
            sizes="(max-width: 64rem) 100vw, 640px"
            src="/landing/pelvic-rest.webp"
          />
          <Image
            alt=""
            className={styles.frame}
            data-on={(showHold ? 1 : pose) === 1}
            fill
            priority
            sizes="(max-width: 64rem) 100vw, 640px"
            src="/landing/pelvic-hold.webp"
          />
        </div>
        {live ? (
          <div className={styles.figure} data-ready={figure === "ready"}>
            <HeroFigure
              onError={handleError}
              onReady={handleReady}
              pose={showHold ? 1 : pose}
              reducedMotion={reducedMotion}
              transitionMs={transitionMs(speed)}
            />
          </div>
        ) : null}
        <div className={styles.stageCaption} data-show={playing}>
          {caption}
        </div>
      </div>

      <div className={styles.stageFoot}>
        <div className={styles.stageInfo}>
          <p className={styles.exercise}>{EXERCISE}</p>
          <p className={styles.reps} aria-live="off">
            Rep {rep} of {REPS}
          </p>
        </div>
        <div className={styles.stageControls}>
          <div className={styles.pace} role="group" aria-label="Playback speed">
            <button aria-pressed={speed === 0.5} className={styles.paceBtn} onClick={() => setSpeed(0.5)} type="button">
              0.5x
            </button>
            <button aria-pressed={speed === 1} className={styles.paceBtn} onClick={() => setSpeed(1)} type="button">
              1.0x
            </button>
          </div>
          <button
            aria-label={paused ? "Play the demonstration" : "Pause the demonstration"}
            className={styles.playBtn}
            disabled={reducedMotion}
            onClick={() => setPaused((value) => !value)}
            type="button"
          >
            {paused || reducedMotion ? "Play" : "Pause"}
          </button>
        </div>
      </div>
    </section>
  );
}
