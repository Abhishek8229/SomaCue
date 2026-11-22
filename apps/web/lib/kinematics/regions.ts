import { Vector3 } from "three";
import type { BodyRig, RigJoint } from "./rig";
import type { Region } from "./vocabulary";

/** Each region is a capsule between two joints, used for the glow and for picking. */
const REGION_SEGMENTS: Record<Region, { from: RigJoint | "headTop"; to: RigJoint | "headTop"; radius: number }> = {
  head: { from: "head", to: "headTop", radius: 0.12 },
  cervical: { from: "neck", to: "head", radius: 0.075 },
  thoracic: { from: "spine2", to: "neck", radius: 0.16 },
  lumbar: { from: "spine1", to: "spine2", radius: 0.15 },
  pelvis: { from: "thighL", to: "thighR", radius: 0.14 },
  shoulder_left: { from: "clavicleL", to: "upperarmL", radius: 0.09 },
  shoulder_right: { from: "clavicleR", to: "upperarmR", radius: 0.09 },
  elbow_left: { from: "lowerarmL", to: "lowerarmL", radius: 0.07 },
  elbow_right: { from: "lowerarmR", to: "lowerarmR", radius: 0.07 },
  wrist_hand_left: { from: "handL", to: "middleL", radius: 0.07 },
  wrist_hand_right: { from: "handR", to: "middleR", radius: 0.07 },
  hip_left: { from: "thighL", to: "thighL", radius: 0.11 },
  hip_right: { from: "thighR", to: "thighR", radius: 0.11 },
  knee_left: { from: "calfL", to: "calfL", radius: 0.085 },
  knee_right: { from: "calfR", to: "calfR", radius: 0.085 },
  ankle_foot_left: { from: "footL", to: "ballLeafL", radius: 0.08 },
  ankle_foot_right: { from: "footR", to: "ballLeafR", radius: 0.08 },
};

export type RegionCapsule = { region: Region; a: Vector3; b: Vector3; radius: number };

function jointWorld(rig: BodyRig, joint: RigJoint | "headTop") {
  if (joint === "headTop") return rig.headTopLocal.clone().applyMatrix4(rig.bones.head.matrixWorld);
  return rig.bones[joint].getWorldPosition(new Vector3());
}

export function regionCapsule(rig: BodyRig, region: Region): RegionCapsule {
  const def = REGION_SEGMENTS[region];
  return { region, a: jointWorld(rig, def.from), b: jointWorld(rig, def.to), radius: def.radius };
}

export function regionCenter(rig: BodyRig, regions: readonly Region[]) {
  if (regions.length === 0) return null;
  const center = new Vector3();
  for (const region of regions) {
    const capsule = regionCapsule(rig, region);
    center.add(capsule.a).add(capsule.b);
  }
  return center.multiplyScalar(1 / (regions.length * 2));
}

/** Region under a world-space point, picked against the region capsules. */
export function regionAtPoint(rig: BodyRig, point: Vector3): Region | null {
  let best: { region: Region; score: number } | null = null;
  for (const region of Object.keys(REGION_SEGMENTS) as Region[]) {
    const { a, b, radius } = regionCapsule(rig, region);
    const ab = b.clone().sub(a);
    const t = Math.min(1, Math.max(0, point.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    const score = point.distanceTo(a.clone().addScaledVector(ab, t)) / radius;
    if (score < 1.6 && (!best || score < best.score)) best = { region, score };
  }
  return best?.region ?? null;
}
