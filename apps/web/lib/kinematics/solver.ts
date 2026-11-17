import { Bone, Quaternion, Vector3 } from "three";
import {
  clampPose,
  entriesToDofs,
  lerpPose,
  mergePoses,
  mirrorPins,
  type DofPose,
  type MovementSpec,
} from "./movement-spec";
import { POSTURE_DEFS } from "./postures";
import {
  ANTERIOR,
  LEFT,
  UP,
  SIDE_KEYS,
  groupLowest,
  lateralOf,
  medialOf,
  rotateBoneWorld,
  sampleVertices,
  segmentDistance,
  type BodyRig,
  type CapsuleId,
  type ContactGroup,
  type RigJoint,
  type SideKey,
} from "./rig";
import type { Pin, Posture } from "./vocabulary";

const DEG = Math.PI / 180;
const MAX_LEVEL_PITCH = 40 * DEG;
export const SECONDARY_CONTACT_M = 0.03;

const axisAngle = (axis: Vector3, degrees: number) =>
  new Quaternion().setFromAxisAngle(axis.clone().normalize(), degrees * DEG);

const crossAxis = (from: Vector3, toward: Vector3) => {
  const axis = new Vector3().crossVectors(from, toward);
  return axis.lengthSq() < 1e-10 ? null : axis.normalize();
};

/** Rotation that moves `from` toward `toward` by `degrees`. */
function swingToward(from: Vector3, toward: Vector3, degrees: number) {
  const axis = crossAxis(from, toward);
  return axis && degrees !== 0 ? axisAngle(axis, degrees) : new Quaternion();
}

/** Twist about `boneDir`, signed so positive turns `ref` toward `toward`. */
function twistAbout(boneDir: Vector3, ref: Vector3, toward: Vector3, degrees: number) {
  if (degrees === 0) return new Quaternion();
  const turn = crossAxis(ref, toward);
  const sign = turn && turn.dot(boneDir) < 0 ? -1 : 1;
  return axisAngle(boneDir, sign * degrees);
}

/** Direction change from a list of sequential swings, as one minimal swing. */
function composedSwing(rest: Vector3, swings: Array<[Vector3, Vector3, number]>) {
  const dir = rest.clone();
  for (const [ref, toward, degrees] of swings) {
    if (degrees === 0) continue;
    const axis = crossAxis(ref, toward);
    if (axis) dir.applyQuaternion(axisAngle(axis, degrees));
  }
  return new Quaternion().setFromUnitVectors(rest.clone().normalize(), dir.normalize());
}

const get = (pose: DofPose, segment: string, side: "L" | "R" | "C", dof: string) =>
  pose[`${segment}.${side}.${dof}`] ?? 0;

function setLocal(rig: BodyRig, bone: Bone, bodyRotation: Quaternion) {
  const parent = bone.parent as Bone;
  const parentNeutral = rig.neutralWorld.get(parent) ?? new Quaternion();
  const neutral = rig.neutralWorld.get(bone) as Quaternion;
  // local = parentNeutralWorld^-1 * R * neutralWorld (see docs/3d-engine/plan.md, section 6.5)
  bone.quaternion.copy(parentNeutral.clone().invert().multiply(bodyRotation).multiply(neutral));
}

/**
 * Converts a clinical pose to bone rotations. Every rotation is expressed in
 * the body frame of the anatomical neutral pose and applied in the parent's
 * moved frame, so joint angles compose like a goniometer reading.
 */
export function applyDofPose(rig: BodyRig, pose: DofPose) {
  const { bones, dirs } = rig;
  for (const bone of rig.mesh.skeleton.bones) {
    const neutral = rig.neutralLocal.get(bone);
    if (neutral) bone.quaternion.copy(neutral);
  }

  // Pelvis tilt. The lumbar spine and both hips cancel it, so only the pelvis rocks.
  const tilt = get(pose, "pelvis", "C", "tilt");
  const tiltAxis = crossAxis(UP, ANTERIOR) as Vector3;
  const pelvisR = axisAngle(tiltAxis, tilt);
  const untilt = axisAngle(tiltAxis, -tilt);
  setLocal(rig, bones.pelvis, pelvisR);

  const spineRotation = (flex: number, lat: number, rot: number) =>
    composedSwing(dirs.spine, [
      [UP, ANTERIOR, flex],
      [UP, LEFT, lat],
    ]).multiply(axisAngle(UP, rot));

  const lumbar = {
    flex: get(pose, "lumbar", "C", "flex"),
    lat: get(pose, "lumbar", "C", "lat"),
    rot: get(pose, "lumbar", "C", "rot"),
  };
  const thoracic = {
    flex: get(pose, "thoracic", "C", "flex"),
    lat: get(pose, "thoracic", "C", "lat"),
    rot: get(pose, "thoracic", "C", "rot"),
  };
  setLocal(rig, bones.spine1, untilt.clone().multiply(spineRotation(lumbar.flex * 0.5, lumbar.lat * 0.5, lumbar.rot * 0.5)));
  setLocal(
    rig,
    bones.spine2,
    spineRotation(lumbar.flex * 0.5 + thoracic.flex * 0.3, lumbar.lat * 0.5 + thoracic.lat * 0.3, lumbar.rot * 0.5 + thoracic.rot * 0.3),
  );
  setLocal(rig, bones.spine3, spineRotation(thoracic.flex * 0.7, thoracic.lat * 0.7, thoracic.rot * 0.7));

  const cervical = {
    flex: get(pose, "cervical", "C", "flex"),
    lat: get(pose, "cervical", "C", "lat"),
    rot: get(pose, "cervical", "C", "rot"),
    retract: get(pose, "cervical", "C", "retract"),
  };
  setLocal(
    rig,
    bones.neck,
    spineRotation(cervical.flex * 0.6 - cervical.retract * 0.6, cervical.lat * 0.6, cervical.rot * 0.5),
  );
  setLocal(rig, bones.head, spineRotation(cervical.flex * 0.4 + cervical.retract, cervical.lat * 0.4, cervical.rot * 0.5));

  for (const side of SIDE_KEYS) applyArm(rig, pose, side);
  for (const side of SIDE_KEYS) applyLeg(rig, pose, side, untilt);
}

function applyArm(rig: BodyRig, pose: DofPose, side: SideKey) {
  const { bones, dirs } = rig;
  const lateral = lateralOf(side);
  const medial = medialOf(side);
  const flex = get(pose, "shoulder", side, "flex");
  const abd = get(pose, "shoulder", side, "abd");
  const horiz = get(pose, "shoulder", side, "horiz");
  const rot = get(pose, "shoulder", side, "rot");

  // Arm direction relative to the thorax.
  const rest = dirs.upperarm[side];
  const down = UP.clone().negate();
  const target = rest.clone();
  if (abd) target.applyQuaternion(swingToward(down, lateral, abd));
  if (flex) target.applyQuaternion(swingToward(down, ANTERIOR, flex));
  if (horiz) target.applyQuaternion(axisAngle(crossAxis(ANTERIOR, medial) as Vector3, horiz));
  target.normalize();

  // Scapulohumeral rhythm: about one degree of scapula per two of humerus above 30 degrees.
  const elevation = Math.acos(Math.min(1, Math.max(-1, target.dot(down)))) / DEG;
  const rhythm = Math.max(0, elevation - 30) / 3;
  const scapElev = get(pose, "scapula", side, "elev") + rhythm * 0.45;
  const scapProtr = get(pose, "scapula", side, "protr");
  const clavicleR = composedSwing(dirs.clavicle[side], [
    [dirs.clavicle[side], UP, scapElev],
    [dirs.clavicle[side], ANTERIOR, scapProtr],
  ]);
  setLocal(rig, bones[`clavicle${side}`], clavicleR);

  // The clavicle already moved the arm, so aim the humerus inside its frame.
  const aim = target.clone().applyQuaternion(clavicleR.clone().invert()).normalize();
  const swing = new Quaternion().setFromUnitVectors(rest, aim);
  const twist = twistAbout(rest, ANTERIOR, medial, rot);
  setLocal(rig, bones[`upperarm${side}`], swing.multiply(twist));

  const elbow = get(pose, "elbow", side, "flex");
  const pron = get(pose, "forearm", side, "pron");
  const forearm = dirs.forearm[side];
  const hinge = swingToward(forearm, ANTERIOR, elbow);
  const pronation = twistAbout(forearm, medial, ANTERIOR.clone().negate(), pron);
  setLocal(rig, bones[`lowerarm${side}`], hinge.multiply(pronation));

  const hand = dirs.hand[side];
  setLocal(
    rig,
    bones[`hand${side}`],
    composedSwing(hand, [
      [hand, rig.palmNormal[side], get(pose, "wrist", side, "flex")],
      [hand, rig.radial[side], get(pose, "wrist", side, "dev")],
    ]),
  );
}

function applyLeg(rig: BodyRig, pose: DofPose, side: SideKey, untilt: Quaternion) {
  const { bones, dirs } = rig;
  const lateral = lateralOf(side);
  const medial = medialOf(side);
  const thigh = dirs.thigh[side];
  const swing = composedSwing(thigh, [
    [thigh, lateral, get(pose, "hip", side, "abd")],
    [thigh, ANTERIOR, get(pose, "hip", side, "flex")],
  ]);
  const twist = twistAbout(thigh, ANTERIOR, medial, get(pose, "hip", side, "rot"));
  setLocal(rig, bones[`thigh${side}`], untilt.clone().multiply(swing).multiply(twist));

  const shank = dirs.shank[side];
  setLocal(rig, bones[`calf${side}`], swingToward(shank, ANTERIOR.clone().negate(), get(pose, "knee", side, "flex")));

  const foot = dirs.foot[side];
  const dorsi = swingToward(foot, UP, get(pose, "ankle", side, "dorsi"));
  const inversion = twistAbout(foot, UP.clone().negate(), medial, get(pose, "ankle", side, "inv"));
  setLocal(rig, bones[`foot${side}`], dorsi.multiply(inversion));
}

export type PostureFrame = { quaternion: Quaternion; position: Vector3 };

const groupPoints = (rig: BodyRig, group: ContactGroup) => {
  const list = rig.sampler.groups[group];
  const w = rig.sampler.world;
  const out: Vector3[] = new Array(list.length);
  for (let k = 0; k < list.length; k++) {
    const i = list[k] * 3;
    out[k] = new Vector3(w[i], w[i + 1], w[i + 2]);
  }
  return out;
};

function lowestOf(points: Vector3[], q: Quaternion, offset: Vector3) {
  let best: Vector3 | null = null;
  const p = new Vector3();
  for (const point of points) {
    p.copy(point).applyQuaternion(q).add(offset);
    if (!best || p.y < best.y) best = p.clone();
  }
  return best;
}

export type SupportOptions = { secondary: boolean; extraPitchDeg?: number };

/**
 * For postures supported at both ends, part of the spinal flexion becomes an
 * opposite pelvic tilt. The hips are corrected so the thighs keep their angle.
 */
export function supportedPose(posture: Posture, pose: DofPose) {
  const share = POSTURE_DEFS[posture].pelvisFollowsSpine ?? 0;
  if (!share) return { pose, extraPitchDeg: 0 };
  const flexion = (pose["lumbar.C.flex"] ?? 0) + (pose["thoracic.C.flex"] ?? 0);
  const comp = flexion * share;
  // The chest ends up tilted by the rest of the flexion. Keep the arms vertical.
  const chest = flexion - comp;
  return {
    pose: {
      ...pose,
      "hip.L.flex": (pose["hip.L.flex"] ?? 0) - comp,
      "hip.R.flex": (pose["hip.R.flex"] ?? 0) - comp,
      "shoulder.L.flex": (pose["shoulder.L.flex"] ?? 0) - chest,
      "shoulder.R.flex": (pose["shoulder.R.flex"] ?? 0) - chest,
    },
    extraPitchDeg: -comp,
  };
}

/**
 * Places the posed body on its support: rotate for the posture, keep the
 * second contact group on the floor by pitching about the body's left axis,
 * then lift so the primary group rests on the support and nothing is below
 * the floor. Uses body-space vertex samples, so call after applyDofPose.
 */
export function solveSupport(rig: BodyRig, posture: Posture, options: SupportOptions): PostureFrame {
  const def = POSTURE_DEFS[posture];
  // Measure the seat first: it re-poses the rig temporarily.
  const supportY = def.support === "seat" ? seatHeight(rig) : 0;
  rig.root.position.set(0, 0, 0);
  rig.root.quaternion.identity();
  rig.root.updateMatrixWorld(true);
  sampleVertices(rig.mesh, rig.sampler);

  const primary = groupPoints(rig, def.primary);
  const secondary = def.secondary && options.secondary ? groupPoints(rig, def.secondary) : null;
  const all = groupPoints(rig, "all");

  let q = axisAngle(LEFT, def.pitchDeg + (options.extraPitchDeg ?? 0));
  let offset = new Vector3();
  let pitch = 0;

  if (secondary && secondary.length && primary.length) {
    for (let iteration = 0; iteration < 6; iteration++) {
      const a = lowestOf(primary, q, offset) as Vector3;
      const b = lowestOf(secondary, q, offset) as Vector3;
      const dz = b.z - a.z;
      if (Math.abs(dz) < 0.05) break;
      // A small rotation phi about +X moves b's height by about -dz * phi.
      let step = (b.y - a.y) / dz;
      step = Math.max(-MAX_LEVEL_PITCH - pitch, Math.min(MAX_LEVEL_PITCH - pitch, step));
      if (Math.abs(step) < 1e-4) break;
      pitch += step;
      const r = new Quaternion().setFromAxisAngle(LEFT, step);
      // pivot about the primary contact point
      offset = offset.clone().sub(a).applyQuaternion(r).add(a);
      q = r.multiply(q);
    }
  }

  const lowPrimary = lowestOf(primary, q, offset) as Vector3;
  offset.y += supportY - lowPrimary.y;
  if (secondary && secondary.length) {
    const lowSecondary = lowestOf(secondary, q, offset) as Vector3;
    if (lowSecondary.y < 0) offset.y -= lowSecondary.y;
  }
  const lowest = lowestOf(all, q, offset) as Vector3;
  if (lowest.y < 0) offset.y -= lowest.y;

  rig.root.quaternion.copy(q);
  rig.root.position.copy(offset);
  rig.root.updateMatrixWorld(true);
  return { quaternion: q.clone(), position: offset.clone() };
}

/** Seat height that lets the seated base pose rest both feet on the floor. */
export function seatHeight(rig: BodyRig) {
  if (rig.seatHeight > 0) return rig.seatHeight;
  const saved = rig.mesh.skeleton.bones.map((bone) => bone.quaternion.clone());
  const savedPosition = rig.root.position.clone();
  const savedQuaternion = rig.root.quaternion.clone();
  rig.root.position.set(0, 0, 0);
  rig.root.quaternion.identity();
  applyDofPose(rig, basePose("seated"));
  rig.root.updateMatrixWorld(true);
  sampleVertices(rig.mesh, rig.sampler);
  const seat = groupLowest(rig.sampler, "seat") as Vector3;
  const feet = groupLowest(rig.sampler, "feet") as Vector3;
  rig.seatHeight = Math.max(0.3, seat.y - feet.y);
  rig.mesh.skeleton.bones.forEach((bone, i) => bone.quaternion.copy(saved[i]));
  rig.root.position.copy(savedPosition);
  rig.root.quaternion.copy(savedQuaternion);
  rig.root.updateMatrixWorld(true);
  return rig.seatHeight;
}

export function basePose(posture: Posture): DofPose {
  return clampPose(entriesToDofs(POSTURE_DEFS[posture].base));
}

export function startPose(spec: MovementSpec, mirrored: boolean): DofPose {
  return clampPose(mergePoses(basePose(spec.posture), entriesToDofs(spec.startPose, mirrored)));
}

export function endPose(spec: MovementSpec, mirrored: boolean): DofPose {
  return clampPose(mergePoses(startPose(spec, mirrored), entriesToDofs(spec.movements, mirrored)));
}

export function poseAt(spec: MovementSpec, progress: number, mirrored: boolean): DofPose {
  return lerpPose(startPose(spec, mirrored), endPose(spec, mirrored), progress);
}

const PIN_LIMB: Record<Pin, { upper: RigJoint; lower: RigJoint; end: RigJoint; group: ContactGroup }> = {
  left_hand: { upper: "upperarmL", lower: "lowerarmL", end: "handL", group: "hands" },
  right_hand: { upper: "upperarmR", lower: "lowerarmR", end: "handR", group: "hands" },
  left_foot: { upper: "thighL", lower: "calfL", end: "footL", group: "feet" },
  right_foot: { upper: "thighR", lower: "calfR", end: "footR", group: "feet" },
};

/** Analytic two-bone IK in the plane of the current limb. Returns the miss distance. */
export function twoBoneIK(upper: Bone, lower: Bone, end: Bone, target: Vector3) {
  // Keep the hand or foot facing the way it did before the limb moved.
  const endWorld = end.getWorldQuaternion(new Quaternion());
  const a = upper.getWorldPosition(new Vector3());
  const b = lower.getWorldPosition(new Vector3());
  const c = end.getWorldPosition(new Vector3());
  const lab = a.distanceTo(b);
  const lbc = b.distanceTo(c);
  const toTarget = target.clone().sub(a);
  const lat = Math.min(Math.max(toTarget.length(), Math.abs(lab - lbc) + 1e-4), lab + lbc - 1e-4);
  const dt = toTarget.normalize();
  const cosA = Math.min(1, Math.max(-1, (lab * lab + lat * lat - lbc * lbc) / (2 * lab * lat)));
  const bend = b.clone().sub(a);
  const perp = bend.sub(dt.clone().multiplyScalar(bend.dot(dt)));
  if (perp.lengthSq() < 1e-10) perp.copy(new Vector3(0, 1, 0).cross(dt)).normalize();
  else perp.normalize();
  const desiredB = a.clone().add(dt.clone().multiplyScalar(cosA * lab)).add(perp.multiplyScalar(Math.sqrt(1 - cosA * cosA) * lab));

  rotateBoneWorld(upper, new Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), desiredB.clone().sub(a).normalize()));
  const nb = lower.getWorldPosition(new Vector3());
  const nc = end.getWorldPosition(new Vector3());
  rotateBoneWorld(lower, new Quaternion().setFromUnitVectors(nc.clone().sub(nb).normalize(), target.clone().sub(nb).normalize()));
  const parentWorld = (end.parent as Bone).getWorldQuaternion(new Quaternion());
  end.quaternion.copy(parentWorld.invert().multiply(endWorld));
  end.updateMatrixWorld(true);
  return end.getWorldPosition(new Vector3()).distanceTo(target);
}

export type PlantedPins = Partial<Record<Pin, Vector3>>;

/** Where each pinned hand or foot is planted: its start position, resting on the floor. */
export function plantPins(rig: BodyRig, pins: readonly Pin[]): PlantedPins {
  const planted: PlantedPins = {};
  rig.root.updateMatrixWorld(true);
  sampleVertices(rig.mesh, rig.sampler);
  for (const pin of pins) {
    const limb = PIN_LIMB[pin];
    const joint = rig.bones[limb.end].getWorldPosition(new Vector3());
    const lowest = lowestNear(rig, limb.group, joint);
    planted[pin] = joint.clone().setY(joint.y - (lowest ?? joint.y) + 0.002);
  }
  return planted;
}

/** Lowest vertex of a contact group near a joint (picks one hand or foot). */
function lowestNear(rig: BodyRig, group: ContactGroup, near: Vector3, radius = 0.3) {
  const list = rig.sampler.groups[group];
  const w = rig.sampler.world;
  let lowest: number | null = null;
  for (let k = 0; k < list.length; k++) {
    const i = list[k] * 3;
    if (Math.hypot(w[i] - near.x, w[i + 1] - near.y, w[i + 2] - near.z) > radius) continue;
    if (lowest === null || w[i + 1] < lowest) lowest = w[i + 1];
  }
  return lowest;
}

export function applyPins(rig: BodyRig, planted: PlantedPins) {
  const slip: Partial<Record<Pin, number>> = {};
  for (const [pin, target] of Object.entries(planted) as Array<[Pin, Vector3]>) {
    const limb = PIN_LIMB[pin];
    slip[pin] = twoBoneIK(rig.bones[limb.upper], rig.bones[limb.lower], rig.bones[limb.end], target);
  }
  rig.root.updateMatrixWorld(true);
  return slip;
}

/** Whether the posture's second contact group touches the floor in this pose. */
export function secondaryInContact(rig: BodyRig, posture: Posture, pose: DofPose) {
  const def = POSTURE_DEFS[posture];
  if (!def.secondary) return false;
  if (def.secondaryAlways) return true;
  const supported = supportedPose(posture, pose);
  applyDofPose(rig, supported.pose);
  solveSupport(rig, posture, { secondary: false, extraPitchDeg: supported.extraPitchDeg });
  sampleVertices(rig.mesh, rig.sampler);
  const low = groupLowest(rig.sampler, def.secondary);
  return low !== null && low.y <= SECONDARY_CONTACT_M;
}

export type SolveSetup = {
  secondary: boolean;
  planted: PlantedPins;
  pins: Pin[];
  /** hands that rest on the floor because the exercise leaves those arms free */
  restingHands?: Pin[];
};

const ARM_SEGMENTS = new Set(["scapula", "shoulder", "elbow", "forearm", "wrist"]);

function freeHands(spec: MovementSpec, mirrored: boolean, pins: readonly Pin[]): Pin[] {
  if (!POSTURE_DEFS[spec.posture].handsRest) return [];
  const used = { left: false, right: false };
  for (const entry of [...spec.startPose, ...spec.movements]) {
    if (!ARM_SEGMENTS.has(entry.segment)) continue;
    const side = mirrored && entry.side !== "both" ? (entry.side === "left" ? "right" : "left") : entry.side;
    if (side !== "right") used.left = true;
    if (side !== "left") used.right = true;
  }
  const hands: Pin[] = [];
  if (!used.left && !pins.includes("left_hand")) hands.push("left_hand");
  if (!used.right && !pins.includes("right_hand")) hands.push("right_hand");
  return hands;
}

/**
 * Lower free hands onto the floor by swinging the arm at the shoulder (the
 * elbow keeps its angle). They may slide, unlike pins.
 */
function restHands(rig: BodyRig, hands: readonly Pin[]) {
  if (!hands.length) return;
  for (let iteration = 0; iteration < 4; iteration++) {
    sampleVertices(rig.mesh, rig.sampler);
    let moved = false;
    for (const pin of hands) {
      const limb = PIN_LIMB[pin];
      const shoulder = rig.bones[limb.upper].getWorldPosition(new Vector3());
      const joint = rig.bones[limb.end].getWorldPosition(new Vector3());
      const lowest = lowestNear(rig, "all", joint, 0.42);
      if (lowest === null || Math.abs(lowest - 0.003) < 0.003) continue;
      const reach = joint.distanceTo(shoulder);
      const toWanted = joint.clone().setY(joint.y - lowest + 0.003).sub(shoulder);
      // Keep the shoulder-to-wrist distance: aim along the wanted direction.
      const horizontal = Math.max(0, reach * reach - toWanted.y * toWanted.y);
      const flat = new Vector3(toWanted.x, 0, toWanted.z);
      if (flat.lengthSq() < 1e-8) continue;
      const target = flat.setLength(Math.sqrt(horizontal)).setY(toWanted.y).add(shoulder);
      const from = joint.clone().sub(shoulder).normalize();
      const to = target.sub(shoulder).normalize();
      rotateBoneWorld(rig.bones[limb.upper], new Quaternion().setFromUnitVectors(from, to));
      moved = true;
    }
    rig.root.updateMatrixWorld(true);
    if (!moved) break;
  }
}

/** Everything that is fixed for one exercise side: support mode and planted pins. */
export function prepareMovement(rig: BodyRig, spec: MovementSpec, mirrored: boolean): SolveSetup {
  const start = startPose(spec, mirrored);
  const secondary = secondaryInContact(rig, spec.posture, start);
  const supported = supportedPose(spec.posture, start);
  applyDofPose(rig, supported.pose);
  solveSupport(rig, spec.posture, { secondary, extraPitchDeg: supported.extraPitchDeg });
  const pins = mirrorPins(spec.pins, mirrored);
  return { secondary, pins, planted: plantPins(rig, pins), restingHands: freeHands(spec, mirrored, pins) };
}

export function solvePose(rig: BodyRig, posture: Posture, pose: DofPose, setup: SolveSetup) {
  const supported = supportedPose(posture, pose);
  applyDofPose(rig, supported.pose);
  const frame = solveSupport(rig, posture, { secondary: setup.secondary, extraPitchDeg: supported.extraPitchDeg });
  const slip = applyPins(rig, setup.planted);
  restHands(rig, setup.restingHands ?? []);
  liftAboveFloor(rig);
  return { frame, slip };
}

/** Final guard: IK and resting hands must never push the body through the floor. */
function liftAboveFloor(rig: BodyRig) {
  sampleVertices(rig.mesh, rig.sampler);
  const low = groupLowest(rig.sampler, "all");
  if (low && low.y < -0.0005) {
    rig.root.position.y -= low.y;
    rig.root.updateMatrixWorld(true);
  }
}

const ADJACENT = new Set([
  "trunk|head",
  "trunk|upperarmL",
  "trunk|upperarmR",
  "trunk|thighL",
  "trunk|thighR",
  "upperarmL|forearmL",
  "forearmL|handL",
  "upperarmR|forearmR",
  "forearmR|handR",
  "thighL|shankL",
  "shankL|footL",
  "thighR|shankR",
  "shankR|footR",
]);

export type CapsuleOverlap = { a: CapsuleId; b: CapsuleId; depth: number };

export function capsuleEndpoints(rig: BodyRig, id: CapsuleId) {
  const def = rig.capsules.find((capsule) => capsule.id === id);
  if (!def) throw new Error(`No capsule ${id}`);
  const a = rig.bones[def.from].getWorldPosition(new Vector3());
  const b =
    def.to === "headTop"
      ? rig.headTopLocal.clone().applyMatrix4(rig.bones.head.matrixWorld)
      : rig.bones[def.to].getWorldPosition(new Vector3());
  return { a, b, radius: def.radius };
}

/** Deepest overlap between body segments that are not joined to each other. */
export function deepestOverlap(rig: BodyRig): CapsuleOverlap | null {
  const caps = rig.capsules.map((def) => ({ id: def.id, ...capsuleEndpoints(rig, def.id) }));
  let worst: CapsuleOverlap | null = null;
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
      const key = `${caps[i].id}|${caps[j].id}`;
      const reverse = `${caps[j].id}|${caps[i].id}`;
      if (ADJACENT.has(key) || ADJACENT.has(reverse)) continue;
      const depth = caps[i].radius + caps[j].radius - segmentDistance(caps[i].a, caps[i].b, caps[j].a, caps[j].b);
      if (depth > 0 && (!worst || depth > worst.depth)) worst = { a: caps[i].id, b: caps[j].id, depth };
    }
  }
  return worst;
}

export const OVERLAP_TOLERANCE_M = 0.005;

/**
 * Largest share of the movement (0 to 1) that stays clear of body overlaps,
 * checked at evenly spaced points. The engine never animates past it.
 */
export function safeProgress(rig: BodyRig, spec: MovementSpec, mirrored: boolean, steps = 12) {
  const setup = prepareMovement(rig, spec, mirrored);
  const startOverlap = (() => {
    solvePose(rig, spec.posture, poseAt(spec, 0, mirrored), setup);
    return deepestOverlap(rig)?.depth ?? 0;
  })();
  let safe = 1;
  for (let k = 1; k <= steps; k++) {
    const p = k / steps;
    solvePose(rig, spec.posture, poseAt(spec, p, mirrored), setup);
    const depth = deepestOverlap(rig)?.depth ?? 0;
    // contact already present in the start pose (hands on thighs) is allowed to persist
    if (depth > Math.max(OVERLAP_TOLERANCE_M, startOverlap + OVERLAP_TOLERANCE_M)) {
      safe = (k - 1) / steps;
      break;
    }
  }
  return safe;
}
