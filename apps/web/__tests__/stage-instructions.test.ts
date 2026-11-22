// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readingSeconds, stageInstruction, stepSpeech } from "@/lib/kinematics/instructions";
import { resolveStageExercise } from "@/lib/kinematics/exercise";
import { sampleTimeline } from "@/lib/kinematics/timeline";

const pelvicTilt = resolveStageExercise({
  exerciseName: "Supine Pelvic Tilt",
  voiceCue: "Lie on your back with your knees bent and feet flat on the floor.",
});
const kneeLift = resolveStageExercise({ exerciseName: "Seated Knee Lifts", voiceCue: "Sit tall and lift one knee." });

const at = (exercise: typeof pelvicTilt, seconds: number, playing = true) => {
  const sample = sampleTimeline(exercise.spec!, seconds);
  return stageInstruction(exercise, {
    phase: sample.phase,
    phaseRemaining: sample.phaseRemaining,
    rep: sample.rep,
    mirrored: sample.mirrored,
    playing,
  });
};

describe("live stage instruction", () => {
  it("shows the exercise's own instruction before playing and while moving", () => {
    expect(stageInstruction(pelvicTilt, null)).toMatchObject({
      tag: "Get ready",
      text: "Lie on your back with your knees bent and feet flat on the floor.",
    });
    // pelvic tilt tempo: 2s up, 3s hold, 2s down, 1s rest
    expect(at(pelvicTilt, 1)).toMatchObject({ tag: "Move", text: pelvicTilt.voiceCue, tone: "active" });
  });

  it("counts down the hold in step with the timeline", () => {
    expect(at(pelvicTilt, 2.2)).toMatchObject({ tag: "Hold", countdown: 3 });
    expect(at(pelvicTilt, 4.5)).toMatchObject({ tag: "Hold", countdown: 1 });
  });

  it("guides the return and the rest", () => {
    expect(at(pelvicTilt, 5.5)).toMatchObject({ tag: "Return", text: "Slowly return to the start" });
    expect(at(pelvicTilt, 7.5)).toMatchObject({ tag: "Rest", detail: "Next: rep 2 of 10" });
  });

  it("names the working side and switches it on alternating reps", () => {
    const tempo = kneeLift.spec!.tempo;
    const rep = tempo.upSeconds + tempo.holdSeconds + tempo.downSeconds + tempo.restSeconds;
    expect(at(kneeLift, 0.5)?.side).toBe("Left leg");
    expect(at(kneeLift, rep + 0.5)?.side).toBe("Right leg");
  });

  it("says paused when playback stops mid-exercise and done at the end", () => {
    expect(at(pelvicTilt, 1, false)).toMatchObject({ tag: "Paused", text: pelvicTilt.voiceCue });
    expect(at(pelvicTilt, 9999)).toMatchObject({ tag: "Done", tone: "done" });
  });

  it("still shows the cue for an exercise without motion data", () => {
    const textOnly = resolveStageExercise({ exerciseName: "Diaphragmatic Breathing", voiceCue: "Breathe slowly." });
    expect(stageInstruction(textOnly, null)).toMatchObject({ text: "Breathe slowly.", detail: null });
  });
});

describe("spoken instruction per step", () => {
  const input = (phase: "up" | "hold" | "down" | "rest", rep: number, mirrored = false) => ({
    phase,
    phaseRemaining: 1,
    rep,
    mirrored,
    playing: true,
  });

  it("reads the full instruction on the first rep and a short prompt after", () => {
    expect(stepSpeech(pelvicTilt, input("up", 1))).toBe(
      "Lie on your back with your knees bent and feet flat on the floor. Tighten your tummy muscles gently.",
    );
    expect(stepSpeech(pelvicTilt, input("up", 2))).toBe("Rep 2. Move.");
    expect(stepSpeech(pelvicTilt, input("hold", 1))).toBe("Hold the position. Keep breathing.");
    expect(stepSpeech(pelvicTilt, input("down", 3))).toBe("And return.");
    expect(stepSpeech(pelvicTilt, input("rest", 4))).toBeNull();
  });

  it("names the side on one-sided exercises", () => {
    expect(stepSpeech(kneeLift, input("up", 2, true))).toBe("Rep 2. Right leg. Move.");
  });

  it("estimates a reading pause for muted guided pace", () => {
    expect(readingSeconds("Hold.")).toBeCloseTo(1.2);
    expect(readingSeconds(pelvicTilt.voiceCue)).toBeGreaterThan(4);
    expect(readingSeconds("word ".repeat(200))).toBe(12);
  });
});
