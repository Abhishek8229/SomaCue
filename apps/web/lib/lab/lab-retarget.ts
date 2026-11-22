import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { loadModel } from "@/lib/load-model";
import { MOTION_CLIP_NAME, MOTION_PATH } from "./lab-assets";
import type { LabRig } from "./lab-rig";

type Pair = {
  target: string;
  source: string;
  /** child joints used to align the rest-pose bone direction (limbs only) */
  childTarget?: string;
  childSource?: string;
};

const side = (s: "L" | "R") => {
  const l = s.toLowerCase();
  return [
    { target: `clavicle.${s}`, source: `clavicle_${l}`, childTarget: `upperarm01.${s}`, childSource: `upperarm_${l}` },
    { target: `upperarm01.${s}`, source: `upperarm_${l}`, childTarget: `lowerarm01.${s}`, childSource: `lowerarm_${l}` },
    { target: `lowerarm01.${s}`, source: `lowerarm_${l}`, childTarget: `wrist.${s}`, childSource: `hand_${l}` },
    { target: `wrist.${s}`, source: `hand_${l}`, childTarget: `finger3-1.${s}`, childSource: `middle_01_${l}` },
    { target: `upperleg01.${s}`, source: `thigh_${l}`, childTarget: `lowerleg01.${s}`, childSource: `calf_${l}` },
    { target: `lowerleg01.${s}`, source: `calf_${l}`, childTarget: `foot.${s}`, childSource: `foot_${l}` },
    { target: `foot.${s}`, source: `foot_${l}`, childTarget: `toe3-1.${s}`, childSource: `ball_${l}` },
  ] satisfies Pair[];
};

/**
 * Innerscene bone <- Mesh2Motion bone. Spine bones that have no direct
 * counterpart share a neighbour's rotation; twist, finger, toe and face bones
 * are left at their rest pose relative to their parent.
 */
export const RETARGET_PAIRS: Pair[] = [
  { target: "root", source: "pelvis" },
  { target: "spine04", source: "spine_01" },
  { target: "spine03", source: "spine_01" },
  { target: "spine02", source: "spine_02" },
  { target: "spine01", source: "spine_03" },
  { target: "neck01", source: "neck_01" },
  { target: "head", source: "head" },
  ...side("L"),
  ...side("R"),
];

export type RetargetResult = {
  clip: AnimationClip;
  mappedBones: number;
  requiredBones: number;
  missing: string[];
  frames: number;
  durationS: number;
  sourceChannels: number;
  finite: boolean;
};

const FPS = 30;

/**
 * Retarget the source clip onto the rig by transferring each bone's world-space
 * rotation change, after swinging the target's rest direction onto the source's.
 * That makes an A-pose rig and the source's rest pose comparable, and it never
 * changes bone lengths. The hips translation is scaled by hip height.
 *
 * Precondition: the rig is still in its native pose (call before any posing).
 */
export async function retargetClip(rig: LabRig): Promise<RetargetResult> {
  const gltf = await loadModel(MOTION_PATH);
  const sourceClip =
    gltf.animations.find((clip) => clip.name === MOTION_CLIP_NAME) ?? gltf.animations[0];
  if (!sourceClip) throw new Error("The Mesh2Motion file contains no animation clip.");

  const sourceRoot = gltf.scene.clone(true);
  sourceRoot.updateMatrixWorld(true);
  rig.scene.updateMatrixWorld(true);

  const sourceNode = (name: string) =>
    sourceRoot.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? null;

  const missing: string[] = [];
  type Mapped = {
    pair: Pair;
    target: Bone;
    source: Object3D;
    sourceRestQ: Quaternion;
    targetRestQ: Quaternion;
    swing: Quaternion;
    times: number[];
    values: number[];
  };
  const mapped: Mapped[] = [];

  for (const pair of RETARGET_PAIRS) {
    const source = sourceNode(pair.source);
    if (!rig.hasBone(pair.target) || !source) {
      missing.push(`${pair.target} <- ${pair.source}`);
      continue;
    }
    const target = rig.bone(pair.target);
    let swing = new Quaternion();
    if (pair.childTarget && pair.childSource) {
      const childT = rig.hasBone(pair.childTarget) ? rig.bone(pair.childTarget) : null;
      const childS = sourceNode(pair.childSource);
      if (childT && childS) {
        const dT = childT.getWorldPosition(new Vector3()).sub(target.getWorldPosition(new Vector3())).normalize();
        const dS = childS.getWorldPosition(new Vector3()).sub(source.getWorldPosition(new Vector3())).normalize();
        swing = new Quaternion().setFromUnitVectors(dT, dS);
      } else {
        missing.push(`${pair.target} child ${pair.childTarget} <- ${pair.childSource}`);
      }
    }
    mapped.push({
      pair,
      target,
      source,
      sourceRestQ: source.getWorldQuaternion(new Quaternion()),
      targetRestQ: target.getWorldQuaternion(new Quaternion()),
      swing,
      times: [],
      values: [],
    });
  }

  const byTarget = new Map<Object3D, Mapped>(mapped.map((entry) => [entry.target, entry]));
  const rootTarget = rig.bone("root");
  const rootSource = sourceNode("pelvis");
  if (!rootSource) throw new Error("The Mesh2Motion rig has no pelvis bone.");
  const sourceRestPos = rootSource.getWorldPosition(new Vector3());
  const targetRestPos = rootTarget.position.clone();
  const hipScale = rootTarget.getWorldPosition(new Vector3()).y / sourceRestPos.y;

  // Non-bone ancestors never animate, so their rest world rotation is a constant.
  const staticQ = new Map<Object3D, Quaternion>();
  const restLocal = rig.nativeRest;
  const delta = new Quaternion();
  const inv = new Quaternion();
  const rootTimes: number[] = [];
  const rootValues: number[] = [];

  const mixer = new AnimationMixer(sourceRoot);
  const action = mixer.clipAction(sourceClip);
  action.play();

  const frames = Math.max(2, Math.ceil(sourceClip.duration * FPS) + 1);
  for (let f = 0; f < frames; f++) {
    const time = Math.min(sourceClip.duration, f / FPS);
    mixer.setTime(time);
    sourceRoot.updateMatrixWorld(true);

    const cache = new Map<Object3D, Quaternion>();
    const worldQ = (object: Object3D): Quaternion => {
      const hit = cache.get(object);
      if (hit) return hit;
      let result: Quaternion;
      const entry = byTarget.get(object);
      if (entry) {
        delta
          .copy(entry.source.getWorldQuaternion(new Quaternion()))
          .multiply(inv.copy(entry.sourceRestQ).invert());
        result = delta.clone().multiply(entry.swing).multiply(entry.targetRestQ);
      } else if ((object as Bone).isBone && object.parent) {
        const rest = restLocal.get(object as Bone);
        result = worldQ(object.parent).clone().multiply(rest ? rest.quaternion : object.quaternion);
      } else {
        let stat = staticQ.get(object);
        if (!stat) {
          stat = object.getWorldQuaternion(new Quaternion());
          staticQ.set(object, stat);
        }
        result = stat;
      }
      cache.set(object, result);
      return result;
    };

    for (const entry of mapped) {
      const parentQ = entry.target.parent ? worldQ(entry.target.parent) : new Quaternion();
      const local = parentQ.clone().invert().multiply(worldQ(entry.target));
      const last = entry.values.length;
      if (last >= 4) {
        const dot =
          local.x * entry.values[last - 4] +
          local.y * entry.values[last - 3] +
          local.z * entry.values[last - 2] +
          local.w * entry.values[last - 1];
        if (dot < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      }
      entry.times.push(time);
      entry.values.push(local.x, local.y, local.z, local.w);
    }

    const pelvisPos = rootSource.getWorldPosition(new Vector3());
    const offset = pelvisPos.sub(sourceRestPos).multiplyScalar(hipScale);
    rootTimes.push(time);
    rootValues.push(targetRestPos.x + offset.x, targetRestPos.y + offset.y, targetRestPos.z + offset.z);
  }
  action.stop();

  const tracks = mapped.map(
    (entry) => new QuaternionKeyframeTrack(`${entry.target.name}.quaternion`, entry.times, entry.values),
  );
  tracks.push(new VectorKeyframeTrack(`${rootTarget.name}.position`, rootTimes, rootValues));

  const finite = tracks.every((track) => Array.from(track.values).every(Number.isFinite));
  const clip = new AnimationClip(`${MOTION_CLIP_NAME} (retargeted)`, sourceClip.duration, tracks);

  return {
    clip,
    mappedBones: mapped.length,
    requiredBones: RETARGET_PAIRS.length,
    missing,
    frames,
    durationS: sourceClip.duration,
    sourceChannels: sourceClip.tracks.length,
    finite,
  };
}
