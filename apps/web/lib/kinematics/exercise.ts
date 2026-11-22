import { normalizeSpec, parseMovementSpec, type MovementSpec } from "./movement-spec";
import { findReferenceExercise } from "./reference-exercises";

export type StageExercise = {
  name: string;
  voiceCue: string;
  spec: MovementSpec | null;
  /** plan: the AI prescribed it. reference: matched by name. none: text only. */
  source: "plan" | "reference" | "none";
};

type StepLike = { exerciseName: string; voiceCue: string; movement?: unknown };

/** The movement the stage animates for a plan step, always clamped to the joint table. */
export function resolveStageExercise(step: StepLike): StageExercise {
  const own = parseMovementSpec(step.movement);
  if (own) {
    const { spec } = normalizeSpec(own);
    if (spec.movements.length > 0) {
      return { name: step.exerciseName, voiceCue: step.voiceCue, spec, source: "plan" };
    }
  }
  const reference = findReferenceExercise(step.exerciseName);
  if (reference) {
    return { name: step.exerciseName, voiceCue: step.voiceCue, spec: normalizeSpec(reference.spec).spec, source: "reference" };
  }
  return { name: step.exerciseName, voiceCue: step.voiceCue, spec: null, source: "none" };
}

/** Plain-language description of a movement spec, for the text view and screen readers. */
export function describeSpec(spec: MovementSpec) {
  const sides = (side?: string) => (side && side !== "both" ? `${side} ` : "");
  const parts = spec.movements.map(
    (entry) => `${sides(entry.side)}${entry.segment} ${entry.motion.replaceAll("_", " ")} to ${Math.round(entry.degrees)}°`,
  );
  const { upSeconds, holdSeconds, downSeconds } = spec.tempo;
  return {
    movements: parts,
    tempo: `${upSeconds}s up, ${holdSeconds}s hold, ${downSeconds}s down`,
    dose: `${spec.sets} ${spec.sets === 1 ? "set" : "sets"} of ${spec.reps} reps${spec.alternateSides ? ", alternating sides" : ""}`,
  };
}
