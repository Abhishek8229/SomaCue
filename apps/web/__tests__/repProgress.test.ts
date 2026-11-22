// @vitest-environment node
import { describe, expect, it } from "vitest";
import { completedReps, progressEvent, repProgress } from "@/lib/kinematics/progress";
import type { MovementSpec } from "@/lib/kinematics/movement-spec";
import { sampleTimeline, SET_REST_SECONDS } from "@/lib/kinematics/timeline";

// Same dose as kinematics-core: 2 s up, 1 s hold, 2 s down, 1 s rest; 3 reps x 2 sets.
const baseSpec: MovementSpec = {
  posture: "standing",
  startPose: [],
  movements: [{ segment: "shoulder", motion: "flexion", side: "left", degrees: 90 }],
  alternateSides: false,
  pins: [],
  tempo: { upSeconds: 2, holdSeconds: 1, downSeconds: 2, restSeconds: 1 },
  reps: 3,
  sets: 2,
  targetRegions: ["shoulder_left"],
  cues: [],
  stopIf: [],
};
const REP = 6;
const SET = 3 * REP;

const countAt = (seconds: number, spec: MovementSpec = baseSpec) => completedReps(spec, sampleTimeline(spec, seconds));

describe("completed reps", () => {
  it("counts nothing before the first rep's return ends", () => {
    expect(completedReps(baseSpec, null)).toBe(0);
    expect(sampleTimeline(baseSpec, 1).phase).toBe("up");
    expect(countAt(1)).toBe(0);
    expect(sampleTimeline(baseSpec, 2.5).phase).toBe("hold");
    expect(countAt(2.5)).toBe(0);
    expect(sampleTimeline(baseSpec, 4).phase).toBe("down");
    expect(countAt(4)).toBe(0);
  });

  it("counts a rep in its rest and keeps it through the next rep", () => {
    expect(sampleTimeline(baseSpec, 5.5).phase).toBe("rest");
    expect(countAt(5.5)).toBe(1);
    expect(countAt(REP + 0.5)).toBe(1);
    expect(countAt(2 * REP + 4)).toBe(2);
  });

  it("counts the whole set between sets, then continues in set 2", () => {
    expect(sampleTimeline(baseSpec, SET + 1).phase).toBe("set-rest");
    expect(countAt(SET + 1)).toBe(3);
    expect(countAt(SET + SET_REST_SECONDS + 1)).toBe(3);
    expect(countAt(SET + SET_REST_SECONDS + 5.5)).toBe(4);
  });

  it("counts everything when done", () => {
    expect(sampleTimeline(baseSpec, 999).phase).toBe("done");
    expect(countAt(999)).toBe(6);
    expect(completedReps(baseSpec, { rep: 3, set: 2, phase: "done", done: true })).toBe(6);
  });

  it("treats a missing phase like the start of the rep", () => {
    expect(completedReps(baseSpec, { rep: 2, set: 2, phase: null, done: false })).toBe(4);
  });
});

describe("progress events", () => {
  it("reports a rep when the return phase ends", () => {
    expect(sampleTimeline(baseSpec, 4.9).phase).toBe("down");
    expect(sampleTimeline(baseSpec, 5.1).phase).toBe("rest");
    expect(progressEvent(countAt(4.9), countAt(5.1), baseSpec.reps)).toBe("rep");
  });

  it("reports a rep even without a rest phase", () => {
    const noRest = { ...baseSpec, tempo: { ...baseSpec.tempo, restSeconds: 0 } };
    expect(sampleTimeline(noRest, 4.9).phase).toBe("down");
    expect(sampleTimeline(noRest, 5.1)).toMatchObject({ phase: "up", rep: 2 });
    expect(progressEvent(countAt(4.9, noRest), countAt(5.1, noRest), noRest.reps)).toBe("rep");
  });

  it("reports a set when the last rep of a set ends, including the last set", () => {
    expect(progressEvent(countAt(2 * REP + 4.9), countAt(2 * REP + 5.1), baseSpec.reps)).toBe("set");
    const lastDown = SET + SET_REST_SECONDS + 2 * REP + 4.9;
    expect(sampleTimeline(baseSpec, lastDown)).toMatchObject({ phase: "down", rep: 3, set: 2 });
    expect(progressEvent(countAt(lastDown), countAt(999), baseSpec.reps)).toBe("set");
  });

  it("ignores no change, decreases and jumps", () => {
    expect(progressEvent(2, 2, 3)).toBeNull();
    expect(progressEvent(4, 0, 3)).toBeNull();
    expect(progressEvent(1, 3, 3)).toBeNull();
  });
});

describe("rep progress for the counter", () => {
  it("starts at set 1 with nothing done", () => {
    expect(repProgress(baseSpec, null)).toEqual({ set: 1, setsDone: 0, repsDoneInSet: 0, allDone: false });
  });

  it("follows reps inside a set", () => {
    expect(repProgress(baseSpec, sampleTimeline(baseSpec, REP + 5.5))).toEqual({
      set: 1,
      setsDone: 0,
      repsDoneInSet: 2,
      allDone: false,
    });
  });

  it("shows a full set between sets and an empty one when set 2 starts", () => {
    expect(repProgress(baseSpec, sampleTimeline(baseSpec, SET + 1))).toEqual({
      set: 1,
      setsDone: 1,
      repsDoneInSet: 3,
      allDone: false,
    });
    expect(repProgress(baseSpec, sampleTimeline(baseSpec, SET + SET_REST_SECONDS + 1))).toEqual({
      set: 2,
      setsDone: 1,
      repsDoneInSet: 0,
      allDone: false,
    });
  });

  it("is all done at the end", () => {
    expect(repProgress(baseSpec, sampleTimeline(baseSpec, 999))).toEqual({
      set: 2,
      setsDone: 2,
      repsDoneInSet: 3,
      allDone: true,
    });
  });
});
