"use client";

import { useEffect, useState } from "react";
import { playRepChime, playSetChime } from "@/lib/audio/celebrationSound";
import { completedReps, progressEvent, type ProgressEvent } from "@/lib/kinematics/progress";
import type { StageHud } from "./stage-types";

export type Celebration = { kind: ProgressEvent; id: number };

export const CELEBRATION_MS: Record<ProgressEvent, number> = { rep: 650, set: 1600 };

type Options = {
  spec: { sets: number; reps: number } | null;
  hud: StageHud | null;
  playing: boolean;
  stopped: boolean;
  /** changes with the exercise and every restart; resets the count without celebrating */
  resetKey: string;
};

type Tracked = { resetKey: string; count: number; seq: number; celebration: Celebration | null };

/**
 * Watches the stage progress and celebrates each completed rep (small) and
 * set (bigger) with a chime and a short-lived celebration for the counter.
 * Celebrations only happen during playback, never on restarts or jumps.
 */
export function useRepCelebration({ spec, hud, playing, stopped, resetKey }: Options) {
  const count = spec ? completedReps(spec, hud) : 0;
  const [tracked, setTracked] = useState<Tracked>({ resetKey, count, seq: 0, celebration: null });

  // Adjust state while rendering when the progress changes (React's
  // "storing information from previous renders" pattern).
  if (tracked.resetKey !== resetKey || tracked.count !== count) {
    const sameRun = tracked.resetKey === resetKey;
    // The last frame of an exercise ends playback in the same update, so done still counts.
    const live = !stopped && (playing || Boolean(hud?.done));
    const event = sameRun && live && spec ? progressEvent(tracked.count, count, spec.reps) : null;
    const seq = event ? tracked.seq + 1 : tracked.seq;
    setTracked({
      resetKey,
      count,
      seq,
      celebration: event ? { kind: event, id: seq } : sameRun ? tracked.celebration : null,
    });
  }

  const celebration = tracked.celebration;

  // Sound and clean-up are side effects, so they run after the render commits.
  useEffect(() => {
    if (!celebration) return;
    if (celebration.kind === "set") playSetChime();
    else playRepChime();
    const timer = window.setTimeout(() => {
      setTracked((current) =>
        current.celebration?.id === celebration.id ? { ...current, celebration: null } : current,
      );
    }, CELEBRATION_MS[celebration.kind]);
    return () => window.clearTimeout(timer);
  }, [celebration]);

  return { celebration, count };
}
