import type { Phase } from "./timeline";

type Dose = { sets: number; reps: number };
type HudProgress = { rep: number; set: number; phase: Phase | null; done: boolean };

/**
 * Total reps completed across the whole exercise. A rep counts as complete
 * once its "down" phase ends (the timeline moves to rest, set-rest, done or
 * the next rep's "up"), so this also works when the rest phase is 0 s.
 */
export function completedReps(spec: Dose, hud: HudProgress | null): number {
  if (!hud) return 0;
  const total = spec.sets * spec.reps;
  if (hud.done || hud.phase === "done") return total;
  const before = (hud.set - 1) * spec.reps;
  let count: number;
  if (hud.phase === "set-rest") count = hud.set * spec.reps;
  else if (hud.phase === "rest") count = before + hud.rep;
  else count = before + hud.rep - 1;
  return Math.min(total, Math.max(0, count));
}

export type ProgressEvent = "rep" | "set";

/**
 * What changed between two completed-rep counts: a single new rep, a single
 * new rep that finished a set, or nothing (no change, a reset or a jump).
 */
export function progressEvent(previous: number, next: number, reps: number): ProgressEvent | null {
  if (next !== previous + 1 || reps <= 0) return null;
  return next % reps === 0 ? "set" : "rep";
}

export type RepProgress = {
  /** current 1-based set, never above the prescribed sets */
  set: number;
  setsDone: number;
  /** completed reps in the current set, 0..reps */
  repsDoneInSet: number;
  allDone: boolean;
};

/** Counter values for the footer. */
export function repProgress(spec: Dose, hud: HudProgress | null): RepProgress {
  const sets = Math.max(1, spec.sets);
  const reps = Math.max(1, spec.reps);
  const done = completedReps(spec, hud);
  const set = Math.min(sets, Math.max(1, hud?.set ?? 1));
  return {
    set,
    setsDone: Math.min(sets, Math.floor(done / reps)),
    repsDoneInSet: Math.min(reps, Math.max(0, done - (set - 1) * reps)),
    allDone: done >= sets * reps,
  };
}
