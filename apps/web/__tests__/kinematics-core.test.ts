// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CLINICAL_RANGES_REVIEWED,
  JOINT_TABLE,
  clampToDof,
  dofLimit,
  prescribedMax,
} from "@/lib/kinematics/joint-table";
import {
  entriesToDofs,
  mirrorPins,
  mirrorRegions,
  movementSpecSchema,
  normalizeSpec,
  type MovementSpec,
} from "@/lib/kinematics/movement-spec";
import { findReferenceExercise, REFERENCE_EXERCISES } from "@/lib/kinematics/reference-exercises";
import { resolveStageExercise } from "@/lib/kinematics/exercise";
import { minimumJerk, sampleTimeline, totalSeconds, SET_REST_SECONDS } from "@/lib/kinematics/timeline";
import { viewLabels } from "@/lib/kinematics/camera-presets";
import { SEGMENT_MOTIONS, type Motion, type Segment } from "@/lib/kinematics/vocabulary";

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

describe("joint table", () => {
  it("has a sourced draft row for every motion in the vocabulary", () => {
    for (const [segment, motions] of Object.entries(SEGMENT_MOTIONS)) {
      for (const motion of Object.keys(motions)) {
        const row = JOINT_TABLE.find((entry) => entry.segment === segment && entry.motion === motion);
        expect(row, `${segment} ${motion}`).toBeDefined();
        expect(row?.sources.length).toBeGreaterThan(0);
        expect(row?.status).toBe("draft-unreviewed");
      }
    }
  });

  it("stays flagged as not clinically reviewed", () => {
    expect(CLINICAL_RANGES_REVIEWED).toBe(false);
  });

  it("clamps prescriptions to a fraction of the normal range", () => {
    expect(prescribedMax("knee", "flexion")).toBeCloseTo(135 * 0.8);
    expect(prescribedMax("shoulder", "flexion")).toBeCloseTo(180 * 0.9);
    expect(dofLimit("hip", "flex")).toEqual({ min: -24, max: 108 });
    expect(clampToDof("knee", "flex", 170)).toBeCloseTo(108);
    expect(clampToDof("knee", "flex", -10)).toBe(0);
  });

  it("uses the same limit to the left and right for spinal rotation", () => {
    const limit = dofLimit("thoracic", "rot");
    expect(limit.min).toBeCloseTo(-limit.max);
    expect(limit.max).toBeCloseTo(24);
  });
});

describe("movement spec", () => {
  it("parses a valid spec and rejects unknown vocabulary", () => {
    expect(movementSpecSchema.safeParse(baseSpec).success).toBe(true);
    const bad = { ...baseSpec, movements: [{ segment: "spleen", motion: "flexion", degrees: 10 }] };
    expect(movementSpecSchema.safeParse(bad).success).toBe(false);
  });

  it("drops impossible motions and clamps angles with a warning", () => {
    const { spec, warnings } = normalizeSpec({
      ...baseSpec,
      movements: [
        { segment: "knee", motion: "abduction" as Motion, degrees: 20 },
        { segment: "knee", motion: "flexion", side: "left", degrees: 160 },
      ],
    });
    expect(spec.movements).toEqual([{ segment: "knee", motion: "flexion", side: "left", degrees: 108 }]);
    expect(warnings).toHaveLength(2);
  });

  it("maps motions to signed degrees of freedom and mirrors sides", () => {
    const dofs = entriesToDofs([
      { segment: "hip", motion: "extension", side: "right", degrees: 10 },
      { segment: "thoracic", motion: "rotation", side: "right", degrees: 20 },
      { segment: "shoulder", motion: "abduction", side: "both", degrees: 30 },
    ]);
    expect(dofs["hip.R.flex"]).toBe(-10);
    expect(dofs["thoracic.C.rot"]).toBe(-20);
    expect(dofs["shoulder.L.abd"]).toBe(30);
    expect(dofs["shoulder.R.abd"]).toBe(30);

    const mirrored = entriesToDofs([{ segment: "hip", motion: "flexion", side: "left", degrees: 40 }], true);
    expect(mirrored["hip.R.flex"]).toBe(40);
    expect(mirrored["hip.L.flex"]).toBeUndefined();
    expect(mirrorPins(["left_foot"], true)).toEqual(["right_foot"]);
    expect(mirrorRegions(["knee_left", "lumbar"], true)).toEqual(["knee_right", "lumbar"]);
  });

  it("every reference exercise is valid and already inside the joint table", () => {
    for (const reference of REFERENCE_EXERCISES) {
      expect(movementSpecSchema.safeParse(reference.spec).success, reference.id).toBe(true);
      expect(normalizeSpec(reference.spec).warnings, reference.id).toEqual([]);
    }
  });
});

describe("timeline", () => {
  it("runs up, hold, down and rest with minimum-jerk easing", () => {
    expect(minimumJerk(0)).toBe(0);
    expect(minimumJerk(0.5)).toBeCloseTo(0.5);
    expect(minimumJerk(1)).toBe(1);
    expect(sampleTimeline(baseSpec, 1).phase).toBe("up");
    expect(sampleTimeline(baseSpec, 2.5)).toMatchObject({ phase: "hold", progress: 1, rep: 1 });
    expect(sampleTimeline(baseSpec, 4).phase).toBe("down");
    expect(sampleTimeline(baseSpec, 5.5)).toMatchObject({ phase: "rest", progress: 0 });
    expect(sampleTimeline(baseSpec, 6.5).rep).toBe(2);
  });

  it("rests between sets and ends done", () => {
    const setLength = 3 * 6;
    expect(sampleTimeline(baseSpec, setLength + 1).phase).toBe("set-rest");
    expect(sampleTimeline(baseSpec, setLength + SET_REST_SECONDS + 1)).toMatchObject({ set: 2, rep: 1 });
    expect(totalSeconds(baseSpec)).toBe(2 * setLength + SET_REST_SECONDS);
    expect(sampleTimeline(baseSpec, 999).done).toBe(true);
  });

  it("mirrors every other rep when alternating", () => {
    const spec = { ...baseSpec, alternateSides: true };
    expect(sampleTimeline(spec, 1).mirrored).toBe(false);
    expect(sampleTimeline(spec, 7).mirrored).toBe(true);
  });
});

describe("exercise resolution", () => {
  it("matches existing plan names to reference demonstrations", () => {
    expect(findReferenceExercise("Supine Pelvic Tilt")?.id).toBe("supine_pelvic_tilt");
    expect(findReferenceExercise("Gentle Cat Cow")?.id).toBe("cat_cow");
    expect(findReferenceExercise("Seated Knee Lifts")?.id).toBe("seated_knee_lift");
    expect(findReferenceExercise("Supine Knee Lifts")?.id).toBe("supine_march");
    expect(findReferenceExercise("Quad Sets")).toBeNull();
  });

  it("prefers the plan's own movement and falls back to text only", () => {
    const own = resolveStageExercise({ exerciseName: "Arm Raise", voiceCue: "Lift", movement: baseSpec });
    expect(own.source).toBe("plan");
    const fallback = resolveStageExercise({ exerciseName: "Gentle Cat Cow", voiceCue: "Round" });
    expect(fallback.source).toBe("reference");
    expect(fallback.spec?.posture).toBe("quadruped");
    const none = resolveStageExercise({ exerciseName: "Diaphragmatic Breathing", voiceCue: "Breathe" });
    expect(none).toMatchObject({ source: "none", spec: null });
  });
});

describe("view labels", () => {
  it("uses Top and Side only for lying postures", () => {
    expect(viewLabels("standing")).toEqual(["Anterior", "Posterior"]);
    expect(viewLabels("seated")).toEqual(["Anterior", "Posterior"]);
    expect(viewLabels("quadruped")).toEqual(["Anterior", "Posterior"]);
    expect(viewLabels("supine")).toEqual(["Top", "Side"]);
    expect(viewLabels("prone")).toEqual(["Top", "Side"]);
  });
});

// Keep the type import used for readers of the test.
export type { Segment };
