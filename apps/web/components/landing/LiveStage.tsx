"use client";

import { useMemo, useReducer } from "react";
import { StageV2 } from "@/components/stage/StageV2";
import { initialStageState, stageReducer } from "@/components/stage/useStageController";
import { SetRepCounter } from "@/components/workspace/SetRepCounter";
import { resolveStageExercise, type StageExercise } from "@/lib/kinematics/exercise";
import { repProgress } from "@/lib/kinematics/progress";
import { findReferenceExercise } from "@/lib/kinematics/reference-exercises";
import { usePrefersReducedMotion } from "@/lib/use-environment";
import styles from "./sections.module.css";

const NAMES = ["Supine Pelvic Tilt", "Cat-Cow", "Bird Dog"];

function buildExercises(): StageExercise[] {
  return NAMES.map((name) => {
    const reference = findReferenceExercise(name);
    return resolveStageExercise({ exerciseName: reference?.name ?? name, voiceCue: reference?.voiceCue ?? "" });
  });
}

const NO_GLOW = { pain: [], flagged: [] };

/** The real workspace stage, with its footer controls, driven by reference exercises (no AI, no database). */
export default function LiveStage() {
  const exercises = useMemo(() => buildExercises(), []);
  const [state, dispatch] = useReducer(stageReducer, undefined, () => ({
    ...initialStageState(NAMES.length),
    voiceOn: false,
  }));
  const reducedMotion = usePrefersReducedMotion();
  const spec = exercises[state.index]?.spec ?? null;

  const go = (target: number) => {
    const step = target > state.index ? "next" : "prev";
    for (let i = 0; i < Math.abs(target - state.index); i++) dispatch({ type: step });
  };

  return (
    <div className={styles.live}>
      <div className={styles.liveStage} data-slot="stage">
        <StageV2
          dayLabel="Sample day"
          dispatch={dispatch}
          exercises={exercises}
          glow={NO_GLOW}
          planUnlocked
          reportsSubmitted
          state={state}
        />
      </div>

      <div className={styles.liveFoot}>
        <div className={styles.liveCounter}>
          {spec ? (
            <SetRepCounter
              celebration={null}
              progress={repProgress(spec, state.hud)}
              reducedMotion={reducedMotion}
              reps={spec.reps}
              sets={spec.sets}
            />
          ) : null}
        </div>

        <div className={styles.liveGroup} role="group" aria-label="Exercise">
          {NAMES.map((name, index) => (
            <button
              aria-pressed={state.index === index}
              className={styles.segBtn}
              key={name}
              onClick={() => go(index)}
              type="button"
            >
              {name}
            </button>
          ))}
        </div>

        <div className={styles.liveGroup}>
          <button
            aria-label={state.playing ? "Pause playback" : "Play playback"}
            className={styles.btnSolid}
            onClick={() => dispatch({ type: "toggle" })}
            type="button"
          >
            {state.playing ? "Pause" : "Play"}
          </button>
          <div className={styles.seg} role="group" aria-label="Speed">
            {([0.5, 1] as const).map((speed) => (
              <button
                aria-pressed={state.speed === speed}
                className={styles.segBtn}
                key={speed}
                onClick={() => dispatch({ type: "speed", speed })}
                type="button"
              >
                {speed.toFixed(1)}x
              </button>
            ))}
          </div>
          <div className={styles.seg} role="group" aria-label="Pace">
            {(["guided", "realtime"] as const).map((pace) => (
              <button
                aria-pressed={state.pace === pace}
                className={styles.segBtn}
                key={pace}
                onClick={() => dispatch({ type: "pace", pace })}
                type="button"
              >
                {pace === "guided" ? "Guided" : "Real-time"}
              </button>
            ))}
          </div>
          <button
            aria-pressed={state.voiceOn}
            className={styles.btnLine}
            disabled={state.pace !== "guided"}
            onClick={() => dispatch({ type: "voice", on: !state.voiceOn })}
            type="button"
          >
            Voice {state.voiceOn ? "on" : "off"}
          </button>
        </div>
      </div>
    </div>
  );
}
