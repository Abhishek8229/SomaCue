import type { MovementSpec } from "./movement-spec";

export type Phase = "up" | "hold" | "down" | "rest" | "set-rest" | "done";

export type TimelineSample = {
  /** 0 at the start pose, 1 at the end of the movement */
  progress: number;
  phase: Phase;
  /** 1-based */
  rep: number;
  /** 1-based */
  set: number;
  /** true on the mirrored reps of an alternating exercise */
  mirrored: boolean;
  done: boolean;
  elapsed: number;
  total: number;
  /** seconds left in the current phase, for the hold countdown */
  phaseRemaining: number;
  /** clock time at which the current phase began */
  phaseStart: number;
  /** stable id of the current step (set, rep, phase), used by guided pacing */
  stepKey: string;
};

export const SET_REST_SECONDS = 8;

/** Minimum-jerk easing, the classic smooth human reaching profile. */
export function minimumJerk(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (10 - 15 * t + 6 * t * t);
}

export function repSeconds(spec: MovementSpec) {
  const { upSeconds, holdSeconds, downSeconds, restSeconds } = spec.tempo;
  return upSeconds + holdSeconds + downSeconds + restSeconds;
}

export function totalSeconds(spec: MovementSpec) {
  return spec.sets * spec.reps * repSeconds(spec) + (spec.sets - 1) * SET_REST_SECONDS;
}

export function sampleTimeline(spec: MovementSpec, elapsed: number): TimelineSample {
  const total = totalSeconds(spec);
  const rep = repSeconds(spec);
  const setLength = spec.reps * rep;
  const t = Math.max(0, elapsed);

  if (t >= total) {
    return {
      progress: 0,
      phase: "done",
      rep: spec.reps,
      set: spec.sets,
      mirrored: spec.alternateSides && (spec.reps - 1) % 2 === 1,
      done: true,
      elapsed: total,
      total,
      phaseRemaining: 0,
      phaseStart: total,
      stepKey: "done",
    };
  }

  const setIndex = Math.min(spec.sets - 1, Math.floor(t / (setLength + SET_REST_SECONDS)));
  const inSet = t - setIndex * (setLength + SET_REST_SECONDS);
  if (inSet >= setLength) {
    return {
      progress: 0,
      phase: "set-rest",
      rep: spec.reps,
      set: setIndex + 1,
      mirrored: false,
      done: false,
      elapsed: t,
      total,
      phaseRemaining: setLength + SET_REST_SECONDS - inSet,
      phaseStart: t - (inSet - setLength),
      stepKey: `set-rest-${setIndex + 1}`,
    };
  }

  const repIndex = Math.min(spec.reps - 1, Math.floor(inSet / rep));
  const inRep = inSet - repIndex * rep;
  const { upSeconds, holdSeconds, downSeconds } = spec.tempo;
  let progress = 0;
  let phase: Phase = "rest";
  let phaseRemaining = rep - inRep;
  let phaseOffset = upSeconds + holdSeconds + downSeconds;
  if (inRep < upSeconds) {
    phase = "up";
    progress = minimumJerk(inRep / upSeconds);
    phaseRemaining = upSeconds - inRep;
    phaseOffset = 0;
  } else if (inRep < upSeconds + holdSeconds) {
    phase = "hold";
    progress = 1;
    phaseRemaining = upSeconds + holdSeconds - inRep;
    phaseOffset = upSeconds;
  } else if (inRep < upSeconds + holdSeconds + downSeconds) {
    phase = "down";
    progress = 1 - minimumJerk((inRep - upSeconds - holdSeconds) / downSeconds);
    phaseRemaining = upSeconds + holdSeconds + downSeconds - inRep;
    phaseOffset = upSeconds + holdSeconds;
  }

  return {
    progress,
    phase,
    rep: repIndex + 1,
    set: setIndex + 1,
    mirrored: spec.alternateSides && repIndex % 2 === 1,
    done: false,
    elapsed: t,
    total,
    phaseRemaining,
    phaseStart: t - (inRep - phaseOffset),
    stepKey: `${setIndex + 1}-${repIndex + 1}-${phase}`,
  };
}

export const PHASE_LABELS: Record<Phase, string> = {
  up: "Moving",
  hold: "Hold",
  down: "Returning",
  rest: "Rest",
  "set-rest": "Rest between sets",
  done: "Complete",
};
