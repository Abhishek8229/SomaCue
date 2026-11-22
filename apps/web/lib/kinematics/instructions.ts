import type { StageExercise } from "./exercise";
import type { Phase } from "./timeline";
import type { Segment } from "./vocabulary";

/** The live caption shown above the figure, in step with the motion. */
export type StageInstruction = {
  /** short tag, for example "Move", "Hold", "Return" */
  tag: string;
  /** the instruction itself, large and readable */
  text: string;
  /** a supporting cue, smaller */
  detail: string | null;
  /** whole seconds left in a hold, otherwise null */
  countdown: number | null;
  /** "Left side" or "Right side" on one-sided and alternating exercises */
  side: string | null;
  tone: "neutral" | "active" | "hold" | "rest" | "done";
};

export type InstructionInput = {
  phase: Phase | null;
  phaseRemaining: number;
  rep: number;
  mirrored: boolean;
  playing: boolean;
};

const LIMB_SIDE_WORD: Partial<Record<Segment, string>> = {
  scapula: "shoulder",
  shoulder: "arm",
  elbow: "arm",
  forearm: "arm",
  wrist: "hand",
  hip: "leg",
  knee: "leg",
  ankle: "foot",
};

/** Which side works on this rep, worded for the patient. */
function sideLabel(exercise: StageExercise, mirrored: boolean) {
  const spec = exercise.spec;
  if (!spec) return null;
  const entry = spec.movements.find((item) => item.side === "left" || item.side === "right");
  if (!entry || !entry.side || entry.side === "both") return null;
  const side = mirrored ? (entry.side === "left" ? "right" : "left") : entry.side;
  const word = LIMB_SIDE_WORD[entry.segment] ?? "side";
  return `${side === "left" ? "Left" : "Right"} ${word}`;
}

/**
 * Picks the caption for the current moment. The exercise's own instruction
 * (its voice cue) leads every movement phase; holds count down; the return and
 * rest phases use plain words and the exercise's extra cues.
 */
export function stageInstruction(exercise: StageExercise | null, input: InstructionInput | null): StageInstruction | null {
  if (!exercise) return null;
  const spec = exercise.spec;
  const cues = spec?.cues ?? [];
  const side = sideLabel(exercise, input?.mirrored ?? false);

  if (!spec || !input || !input.phase) {
    return {
      tag: "Get ready",
      text: exercise.voiceCue,
      detail: spec ? "Press play to start." : null,
      countdown: null,
      side,
      tone: "neutral",
    };
  }

  const { phase, phaseRemaining, rep } = input;
  const repLabel = `Rep ${rep} of ${spec.reps}`;
  const paused = !input.playing && phase !== "done";

  let result: StageInstruction;
  switch (phase) {
    case "up":
      result = { tag: "Move", text: exercise.voiceCue, detail: cues[0] ?? repLabel, countdown: null, side, tone: "active" };
      break;
    case "hold":
      result = {
        tag: "Hold",
        text: "Hold the position",
        detail: cues[1] ?? cues[0] ?? "Keep breathing.",
        countdown: Math.max(1, Math.ceil(phaseRemaining)),
        side,
        tone: "hold",
      };
      break;
    case "down":
      result = { tag: "Return", text: "Slowly return to the start", detail: repLabel, countdown: null, side, tone: "active" };
      break;
    case "rest":
      result = {
        tag: "Rest",
        text: "Relax and breathe",
        detail: rep < spec.reps ? `Next: rep ${rep + 1} of ${spec.reps}` : null,
        countdown: null,
        side: null,
        tone: "rest",
      };
      break;
    case "set-rest":
      result = {
        tag: "Rest",
        text: "Rest before the next set",
        detail: spec.stopIf[0] ? `Stop if: ${spec.stopIf[0]}` : null,
        countdown: Math.max(1, Math.ceil(phaseRemaining)),
        side: null,
        tone: "rest",
      };
      break;
    default:
      result = { tag: "Done", text: "Exercise complete", detail: "Press play to repeat, or Next to continue.", countdown: null, side: null, tone: "done" };
  }

  return paused ? { ...result, tag: "Paused", detail: "Press play to continue." } : result;
}

/** Rough reading time, used when the voice is muted or unavailable in guided pace. */
export function readingSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(1.2, words * 0.32 + 0.4));
}

/**
 * What the voice says at the start of a step. The first rep of an exercise
 * reads the full instruction; later reps use a short prompt so a long
 * instruction is not repeated every time.
 */
export function stepSpeech(exercise: StageExercise | null, input: InstructionInput | null): string | null {
  if (!exercise?.spec || !input?.phase) return null;
  const { spec } = exercise;
  const side = sideLabel(exercise, input.mirrored);
  const sideText = side ? `${side}. ` : "";
  switch (input.phase) {
    case "up":
      if (input.rep === 1) {
        const cue = spec.cues[0] ? ` ${spec.cues[0]}` : "";
        return `${sideText}${exercise.voiceCue}${cue}`;
      }
      return `Rep ${input.rep}. ${sideText}Move.`;
    case "hold":
      return input.rep === 1 ? "Hold the position. Keep breathing." : "Hold.";
    case "down":
      return input.rep === 1 ? "Slowly return to the start." : "And return.";
    case "rest":
      return input.rep === 1 ? "Relax and breathe." : null;
    case "set-rest":
      return "Rest before the next set.";
    default:
      return "Exercise complete. Well done.";
  }
}
