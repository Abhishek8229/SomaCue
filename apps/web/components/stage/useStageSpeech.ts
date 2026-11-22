"use client";

import { useEffect, useRef } from "react";
import type { StageExercise } from "@/lib/kinematics/exercise";
import { readingSeconds, stepSpeech } from "@/lib/kinematics/instructions";
import { enforceSilence, speak, speechSupported, stopSpeaking } from "@/lib/speech";
import type { StageHud } from "./stage-types";
import type { StageAction, StagePace } from "./useStageController";

type Options = {
  exercise: StageExercise | null;
  hud: StageHud | null;
  playing: boolean;
  stopped: boolean;
  pace: StagePace;
  voiceOn: boolean;
  /** changes when the exercise restarts, so the same step key is spoken again */
  restartKey: number;
  dispatch: (action: StageAction) => void;
};

const inputOf = (hud: StageHud, playing: boolean) => ({
  phase: hud.phase,
  phaseRemaining: hud.phaseRemaining,
  rep: hud.rep,
  mirrored: hud.mirrored,
  playing,
});

/**
 * Speaks each step's instruction with the browser's text-to-speech.
 * Guided pace: the figure waits at the start of each step; this hook releases
 * the step when the voice finishes (or after a reading pause when muted).
 * Real-time pace never speaks and never holds the figure.
 */
export function useStageSpeech({ exercise, hud, playing, stopped, pace, voiceOn, restartKey, dispatch }: Options) {
  const hudRef = useRef(hud);
  const exerciseRef = useRef(exercise);
  useEffect(() => {
    hudRef.current = hud;
    exerciseRef.current = exercise;
  }, [hud, exercise]);

  const guided = pace === "guided";
  const waitingStep = guided ? (hud?.waitingStep ?? null) : null;
  const active = playing && !stopped;

  // Guided: say the step, then let the figure perform it.
  useEffect(() => {
    if (!active || !waitingStep) return;
    const current = hudRef.current;
    const text = current ? stepSpeech(exerciseRef.current, inputOf(current, true)) : null;
    const release = () => dispatch({ type: "release", step: waitingStep });
    if (!text) {
      release();
      return;
    }
    if (voiceOn && speechSupported()) {
      const handle = speak(text, release, readingSeconds(text) * 2.5 + 4);
      return () => handle.cancel();
    }
    const timer = window.setTimeout(release, readingSeconds(text) * 1000);
    return () => window.clearTimeout(timer);
  }, [active, waitingStep, voiceOn, restartKey, dispatch]);

  // Guided: announce the end of the exercise once.
  const done = hud?.done ?? false;
  useEffect(() => {
    if (!done || !guided || !voiceOn || stopped || !speechSupported()) return;
    speak("Exercise complete. Well done.", () => {}, 6);
  }, [done, guided, voiceOn, stopped]);

  // Pause, stop, mute, Real-time pace and leaving the stage silence the voice at once.
  // Playback also ends when the exercise finishes, in the same update as the
  // done step, so that alone must not cut off the guided end line above.
  const speechAllowed = guided && voiceOn && !stopped && (playing || done);
  useEffect(() => {
    if (speechAllowed) return;
    stopSpeaking();
    // Keep it silent: a browser voice that ignored the first stop, or started
    // late, is cut off within half a second.
    const watchdog = window.setInterval(enforceSilence, 500);
    return () => window.clearInterval(watchdog);
  }, [speechAllowed]);
  // Switching to another tab or app silences the voice as well.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") stopSpeaking();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, []);
  useEffect(() => () => stopSpeaking(), []);
}
