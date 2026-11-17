// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { loadBodyRigNode } from "@/lib/kinematics/node-body";
import { MotionEngine } from "@/lib/kinematics/engine";
import { REFERENCE_EXERCISES } from "@/lib/kinematics/reference-exercises";
import { groupLowest, sampleVertices, type BodyRig, type RigJoint } from "@/lib/kinematics/rig";
import { applyDofPose, deepestOverlap, poseAt, prepareMovement, safeProgress, solvePose } from "@/lib/kinematics/solver";
import { validateMovement } from "@/lib/kinematics/validate";
import type { DofPose } from "@/lib/kinematics/movement-spec";

let rig: BodyRig;

beforeAll(async () => {
  rig = await loadBodyRigNode();
});

/** World movement of a joint when the body goes from neutral to `pose` (standing frame). */
function moveOf(pose: DofPose, joint: RigJoint) {
  rig.root.position.set(0, 0, 0);
  rig.root.quaternion.identity();
  applyDofPose(rig, {});
  rig.root.updateMatrixWorld(true);
  const before = rig.bones[joint].getWorldPosition(new Vector3());
  applyDofPose(rig, pose);
  rig.root.updateMatrixWorld(true);
  return rig.bones[joint].getWorldPosition(new Vector3()).sub(before);
}

const reference = (id: string) => {
  const found = REFERENCE_EXERCISES.find((exercise) => exercise.id === id);
  if (!found) throw new Error(id);
  return found.spec;
};

describe("anatomical directions on the real mesh (body faces +Z, left is +X)", () => {
  it("hip flexion brings the knee forward and up", () => {
    const d = moveOf({ "hip.L.flex": 60 }, "calfL");
    expect(d.z).toBeGreaterThan(0.2);
    expect(d.y).toBeGreaterThan(0.1);
  });

  it("knee flexion moves the ankle backward", () => {
    expect(moveOf({ "knee.L.flex": 60 }, "footL").z).toBeLessThan(-0.2);
  });

  it("shoulder flexion and abduction raise the hand forward and to the side", () => {
    expect(moveOf({ "shoulder.L.flex": 90 }, "handL").z).toBeGreaterThan(0.3);
    expect(moveOf({ "shoulder.L.abd": 90 }, "handL").x).toBeGreaterThan(0.3);
    expect(moveOf({ "shoulder.R.abd": 90 }, "handR").x).toBeLessThan(-0.3);
  });

  it("elbow flexion brings the hand forward", () => {
    expect(moveOf({ "elbow.L.flex": 90 }, "handL").z).toBeGreaterThan(0.15);
  });

  it("shoulder internal rotation with the elbow bent moves the hand toward the midline", () => {
    applyDofPose(rig, { "elbow.L.flex": 90 });
    rig.root.updateMatrixWorld(true);
    const bent = rig.bones.handL.getWorldPosition(new Vector3());
    applyDofPose(rig, { "elbow.L.flex": 90, "shoulder.L.rot": 60 });
    rig.root.updateMatrixWorld(true);
    expect(rig.bones.handL.getWorldPosition(new Vector3()).x).toBeLessThan(bent.x - 0.1);
  });

  it("lumbar flexion moves the head forward; left lateral flexion moves it left", () => {
    expect(moveOf({ "lumbar.C.flex": 40 }, "head").z).toBeGreaterThan(0.2);
    expect(moveOf({ "lumbar.C.lat": 20 }, "head").x).toBeGreaterThan(0.1);
  });

  it("ankle dorsiflexion lifts the toes", () => {
    expect(moveOf({ "ankle.L.dorsi": 20 }, "ballLeafL").y).toBeGreaterThan(0.04);
  });
});

describe("postures rest on their support", () => {
  it("every reference exercise stays on or above the floor through its motion", () => {
    for (const ref of REFERENCE_EXERCISES) {
      const setup = prepareMovement(rig, ref.spec, false);
      for (const progress of [0, 0.5, 1]) {
        solvePose(rig, ref.spec.posture, poseAt(ref.spec, progress, false), setup);
        sampleVertices(rig.mesh, rig.sampler);
        const low = groupLowest(rig.sampler, "all") as Vector3;
        expect(low.y, `${ref.id} at ${progress}`).toBeGreaterThan(-0.002);
      }
    }
  });

  it("standing feet and lying backs touch the floor", () => {
    const standing = prepareMovement(rig, reference("standing_arm_raise"), false);
    solvePose(rig, "standing", poseAt(reference("standing_arm_raise"), 0, false), standing);
    sampleVertices(rig.mesh, rig.sampler);
    expect(Math.abs((groupLowest(rig.sampler, "feet") as Vector3).y)).toBeLessThan(0.003);

    const supine = reference("heel_slide");
    solvePose(rig, "supine", poseAt(supine, 0, false), prepareMovement(rig, supine, false));
    sampleVertices(rig.mesh, rig.sampler);
    expect((groupLowest(rig.sampler, "back") as Vector3).y).toBeLessThan(0.01);
    expect(rig.bones.head.getWorldPosition(new Vector3()).y).toBeLessThan(0.25);
  });

  it("a glute bridge lifts the pelvis while the feet stay planted", () => {
    const spec = reference("glute_bridge");
    const setup = prepareMovement(rig, spec, false);
    solvePose(rig, "supine", poseAt(spec, 0, false), setup);
    const pelvisDown = rig.bones.pelvis.getWorldPosition(new Vector3()).y;
    const { slip } = solvePose(rig, "supine", poseAt(spec, 1, false), setup);
    const pelvisUp = rig.bones.pelvis.getWorldPosition(new Vector3()).y;
    expect(pelvisUp - pelvisDown).toBeGreaterThan(0.15);
    for (const value of Object.values(slip)) expect(value ?? 0).toBeLessThan(0.005);
  });

  it("cat-cow arches the spine while hands and knees stay on the floor", () => {
    const spec = reference("cat_cow");
    const setup = prepareMovement(rig, spec, false);
    solvePose(rig, "quadruped", poseAt(spec, 1, false), setup);
    sampleVertices(rig.mesh, rig.sampler);
    expect((groupLowest(rig.sampler, "hands") as Vector3).y).toBeLessThan(0.01);
    expect((groupLowest(rig.sampler, "knees") as Vector3).y).toBeLessThan(0.01);
  });

  it("the seated figure sits on a seat with the feet on the floor", () => {
    const spec = reference("chin_tuck");
    solvePose(rig, "seated", poseAt(spec, 0, false), prepareMovement(rig, spec, false));
    sampleVertices(rig.mesh, rig.sampler);
    expect((groupLowest(rig.sampler, "seat") as Vector3).y).toBeCloseTo(rig.seatHeight, 2);
    expect((groupLowest(rig.sampler, "feet") as Vector3).y).toBeLessThan(0.02);
  });
});

describe("validator and engine", () => {
  it("detects body overlap and limits the movement before it", () => {
    applyDofPose(rig, { "hip.L.abd": -30, "hip.R.abd": -30, "knee.L.flex": 20, "knee.R.flex": 20 });
    rig.root.updateMatrixWorld(true);
    expect(deepestOverlap(rig)?.depth ?? 0).toBeGreaterThan(0.005);

    const crossing = {
      ...reference("standing_arm_raise"),
      movements: [
        { segment: "hip" as const, motion: "adduction" as const, side: "both" as const, degrees: 24 },
        { segment: "shoulder" as const, motion: "horizontal_adduction" as const, side: "both" as const, degrees: 100 },
        { segment: "shoulder" as const, motion: "flexion" as const, side: "both" as const, degrees: 90 },
      ],
    };
    expect(safeProgress(rig, crossing, false)).toBeLessThan(1);
  });

  it("passes every reference exercise", () => {
    for (const ref of REFERENCE_EXERCISES) {
      const report = validateMovement(rig, ref.spec, 6);
      expect(report.issues, ref.id).toEqual([]);
    }
  });

  it("stops to a resting pose of the same posture", () => {
    const engine = new MotionEngine(rig);
    engine.setExercise(reference("glute_bridge"));
    for (let i = 0; i < 40; i++) engine.update(0.05, true, 1);
    const raised = rig.bones.pelvis.getWorldPosition(new Vector3()).y;
    engine.stopToRest();
    for (let i = 0; i < 20; i++) engine.update(0.05, false, 1);
    expect(engine.isResting).toBe(true);
    const rested = rig.bones.pelvis.getWorldPosition(new Vector3()).y;
    expect(rested).toBeLessThan(raised - 0.1);
    // still lying: the head stays near the floor
    expect(rig.bones.head.getWorldPosition(new Vector3()).y).toBeLessThan(0.25);
  });

  it("does not advance while paused and honours half speed", () => {
    const engine = new MotionEngine(rig);
    engine.setExercise(reference("standing_arm_raise"));
    engine.update(1, false, 1);
    expect(engine.time).toBe(0);
    engine.update(1, true, 0.5);
    expect(engine.time).toBeCloseTo(0.5);
  });

  it("guided pace waits at the start of every step until it is released", () => {
    const engine = new MotionEngine(rig);
    const spec = reference("standing_arm_raise"); // 3s up, 2s hold, 3s down, 1s rest
    engine.setExercise(spec);
    engine.setGuided(true);

    // Waits before the first movement, however long the voice takes.
    for (let i = 0; i < 40; i++) engine.update(0.05, true, 1);
    expect(engine.time).toBe(0);
    expect(engine.waitingStep).toBe("1-1-up");

    engine.release("1-1-up");
    for (let i = 0; i < 100; i++) engine.update(0.05, true, 1);
    // Stopped exactly at the start of the hold, with the arms fully raised.
    expect(engine.waitingStep).toBe("1-1-hold");
    expect(engine.time).toBeGreaterThanOrEqual(3);
    expect(engine.time).toBeLessThan(3.01);

    engine.release("1-1-hold");
    engine.update(0.05, true, 1);
    expect(engine.time).toBeGreaterThan(3.04);
    expect(engine.waitingStep).toBeNull();
  });

  it("real-time pace never waits, and a restart asks again from the first step", () => {
    const engine = new MotionEngine(rig);
    engine.setExercise(reference("standing_arm_raise"));
    for (let i = 0; i < 20; i++) engine.update(0.05, true, 1);
    expect(engine.time).toBeCloseTo(1);
    expect(engine.waitingStep).toBeNull();

    engine.setGuided(true);
    engine.restart();
    engine.update(0.05, true, 1);
    expect(engine.time).toBe(0);
    expect(engine.waitingStep).toBe("1-1-up");
  });
});
