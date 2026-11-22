import {
  Bone,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  SkinnedMesh,
  Vector3,
} from "three";

/**
 * Canonical joints mapped to the Character Creator 4 skeleton in
 * public/models/athlete-male.glb (CC_Base_* names). This is the only file that
 * knows bone names.
 *
 * CC4 specifics the mapping accounts for:
 * - Hip is the root of both the legs (through CC_Base_Pelvis) and the spine
 *   (through CC_Base_Waist), so it is the joint the solver tilts as "pelvis".
 * - The spine is Waist, Spine01, Spine02 (three segments, like the previous rig).
 *   There is no single neck bone: NeckTwist01 carries the neck and Head the skull.
 * - There is no toe-tip bone. MidToe1 (the middle toe's base) stands in for it.
 * - The skin is weighted to helper bones (Pelvis, *Twist*, *ShareBone, Breast,
 *   JawRoot ...). They keep their neutral local pose and follow their parent;
 *   jointOwners() below assigns each one to the mapped joint it belongs to.
 * - The source rest pose is an A-pose (arms about 32 degrees below horizontal).
 *   createBodyRig() swings the arms to hang at the sides.
 */
export const RIG_BONE_NAMES = {
  pelvis: "CC_Base_Hip",
  spine1: "CC_Base_Waist",
  spine2: "CC_Base_Spine01",
  spine3: "CC_Base_Spine02",
  neck: "CC_Base_NeckTwist01",
  head: "CC_Base_Head",
  clavicleL: "CC_Base_L_Clavicle",
  upperarmL: "CC_Base_L_Upperarm",
  lowerarmL: "CC_Base_L_Forearm",
  handL: "CC_Base_L_Hand",
  middleL: "CC_Base_L_Mid1",
  indexL: "CC_Base_L_Index1",
  pinkyL: "CC_Base_L_Pinky1",
  clavicleR: "CC_Base_R_Clavicle",
  upperarmR: "CC_Base_R_Upperarm",
  lowerarmR: "CC_Base_R_Forearm",
  handR: "CC_Base_R_Hand",
  middleR: "CC_Base_R_Mid1",
  indexR: "CC_Base_R_Index1",
  pinkyR: "CC_Base_R_Pinky1",
  thighL: "CC_Base_L_Thigh",
  calfL: "CC_Base_L_Calf",
  footL: "CC_Base_L_Foot",
  ballL: "CC_Base_L_ToeBase",
  ballLeafL: "CC_Base_L_MidToe1",
  thighR: "CC_Base_R_Thigh",
  calfR: "CC_Base_R_Calf",
  footR: "CC_Base_R_Foot",
  ballR: "CC_Base_R_ToeBase",
  ballLeafR: "CC_Base_R_MidToe1",
} as const;
export type RigJoint = keyof typeof RIG_BONE_NAMES;

/** Body frame of the model: facing +Z, up +Y, the figure's left +X. */
export const ANTERIOR = new Vector3(0, 0, 1);
export const UP = new Vector3(0, 1, 0);
export const LEFT = new Vector3(1, 0, 0);

export type SideKey = "L" | "R";

/** Groups of skin vertices used for floor and support contact. */
export type ContactGroup =
  | "all"
  | "heels"
  | "toes"
  | "feet"
  | "hands"
  | "knees"
  | "seat"
  | "back"
  | "front";

export type VertexSampler = {
  indices: Uint32Array;
  /** bind-space position of each sampled vertex (bindMatrix applied) */
  base: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  /** world positions, rewritten by sampleVertices() */
  world: Float32Array;
  groups: Record<ContactGroup, Uint32Array>;
};

export type CapsuleId =
  | "trunk"
  | "head"
  | "upperarmL"
  | "forearmL"
  | "handL"
  | "upperarmR"
  | "forearmR"
  | "handR"
  | "thighL"
  | "shankL"
  | "footL"
  | "thighR"
  | "shankR"
  | "footR";

export type CapsuleDef = { id: CapsuleId; from: RigJoint; to: RigJoint | "headTop"; radius: number };

export type BodyRig = {
  /** Group the solver moves and rotates for posture and grounding. */
  root: Group;
  model: Object3D;
  mesh: SkinnedMesh;
  bones: Record<RigJoint, Bone>;
  /** local quaternion of every bone in anatomical neutral */
  neutralLocal: Map<Bone, Quaternion>;
  /** body-space world quaternion of every bone in anatomical neutral */
  neutralWorld: Map<Bone, Quaternion>;
  /** body-space joint positions in anatomical neutral */
  neutralPosition: Record<RigJoint, Vector3>;
  dirs: {
    spine: Vector3;
    clavicle: Record<SideKey, Vector3>;
    upperarm: Record<SideKey, Vector3>;
    forearm: Record<SideKey, Vector3>;
    hand: Record<SideKey, Vector3>;
    thigh: Record<SideKey, Vector3>;
    shank: Record<SideKey, Vector3>;
    foot: Record<SideKey, Vector3>;
  };
  palmNormal: Record<SideKey, Vector3>;
  radial: Record<SideKey, Vector3>;
  /** head top in Head bone local space */
  headTopLocal: Vector3;
  sampler: VertexSampler;
  capsules: CapsuleDef[];
  /** body-space height of the standing figure */
  standingHeight: number;
  /** chair seat height that lets the seated figure rest its feet on the floor */
  seatHeight: number;
};

export const SIDE_KEYS: readonly SideKey[] = ["L", "R"];
export const lateralOf = (side: SideKey) => (side === "L" ? LEFT.clone() : LEFT.clone().negate());
export const medialOf = (side: SideKey) => lateralOf(side).negate();

const ARM_NEUTRAL_ABDUCTION_DEG = 6;

function findBodyMesh(model: Object3D): SkinnedMesh {
  let best: SkinnedMesh | null = null;
  model.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (!best || mesh.geometry.attributes.position.count > best.geometry.attributes.position.count) {
      best = mesh;
    }
  });
  if (!best) throw new Error("The body model has no skinned mesh.");
  return best;
}

function worldPos(object: Object3D) {
  return object.getWorldPosition(new Vector3());
}

function direction(from: Object3D, to: Object3D) {
  return worldPos(to).sub(worldPos(from)).normalize();
}

/** Rotate a bone by a world-space delta, keeping its parent fixed. */
export function rotateBoneWorld(bone: Object3D, delta: Quaternion) {
  const world = bone.getWorldQuaternion(new Quaternion());
  const parentWorld = bone.parent
    ? bone.parent.getWorldQuaternion(new Quaternion())
    : new Quaternion();
  bone.quaternion.copy(parentWorld.invert().multiply(delta.clone().multiply(world)));
  bone.updateMatrixWorld(true);
}

/**
 * Wraps a loaded body model, moves it into anatomical neutral (arms hanging
 * at the sides, palms facing the thighs) and records everything the solver
 * needs. The model must be a fresh clone that nothing else animates.
 */
export function createBodyRig(model: Object3D): BodyRig {
  const root = new Group();
  root.name = "SomaBodyRoot";
  root.add(model);
  root.updateMatrixWorld(true);

  const mesh = findBodyMesh(model);
  mesh.frustumCulled = false;
  // Eyes and eyebrows are separate skinned meshes; never cull them either.
  model.traverse((object) => {
    if ((object as SkinnedMesh).isSkinnedMesh) object.frustumCulled = false;
  });
  const bones = {} as Record<RigJoint, Bone>;
  for (const [joint, name] of Object.entries(RIG_BONE_NAMES) as Array<[RigJoint, string]>) {
    const bone = model.getObjectByName(name);
    if (!bone || !(bone as Bone).isBone) throw new Error(`The body rig has no bone named "${name}".`);
    bones[joint] = bone as Bone;
  }

  // The source is a T-pose. Swing each upper arm down to the side.
  for (const side of SIDE_KEYS) {
    const upper = bones[`upperarm${side}`];
    const lower = bones[`lowerarm${side}`];
    const target = UP.clone()
      .negate()
      .multiplyScalar(Math.cos((ARM_NEUTRAL_ABDUCTION_DEG * Math.PI) / 180))
      .add(lateralOf(side).multiplyScalar(Math.sin((ARM_NEUTRAL_ABDUCTION_DEG * Math.PI) / 180)))
      .normalize();
    rotateBoneWorld(upper, new Quaternion().setFromUnitVectors(direction(upper, lower), target));
  }
  root.updateMatrixWorld(true);

  const neutralLocal = new Map<Bone, Quaternion>();
  const neutralWorld = new Map<Bone, Quaternion>();
  for (const bone of mesh.skeleton.bones) {
    neutralLocal.set(bone, bone.quaternion.clone());
    neutralWorld.set(bone, bone.getWorldQuaternion(new Quaternion()));
  }
  const neutralPosition = {} as Record<RigJoint, Vector3>;
  for (const joint of Object.keys(bones) as RigJoint[]) neutralPosition[joint] = worldPos(bones[joint]);

  const perSide = <T>(make: (side: SideKey) => T) => ({ L: make("L"), R: make("R") });
  const dirs: BodyRig["dirs"] = {
    spine: direction(bones.spine1, bones.neck),
    clavicle: perSide((s) => direction(bones[`clavicle${s}`], bones[`upperarm${s}`])),
    upperarm: perSide((s) => direction(bones[`upperarm${s}`], bones[`lowerarm${s}`])),
    forearm: perSide((s) => direction(bones[`lowerarm${s}`], bones[`hand${s}`])),
    hand: perSide((s) => direction(bones[`hand${s}`], bones[`middle${s}`])),
    thigh: perSide((s) => direction(bones[`thigh${s}`], bones[`calf${s}`])),
    shank: perSide((s) => direction(bones[`calf${s}`], bones[`foot${s}`])),
    foot: perSide((s) => direction(bones[`foot${s}`], bones[`ballLeaf${s}`])),
  };

  // Thumb side of the hand, and the palm normal pointing toward the body.
  const radial = perSide((s) => {
    const r = worldPos(bones[`index${s}`]).sub(worldPos(bones[`pinky${s}`]));
    return r.sub(dirs.hand[s].clone().multiplyScalar(r.dot(dirs.hand[s]))).normalize();
  });
  const palmNormal = perSide((s) => {
    const n = new Vector3().crossVectors(dirs.hand[s], radial[s]).normalize();
    if (n.dot(medialOf(s)) < 0) n.negate();
    return n;
  });

  const owners = jointOwners(mesh, bones);
  const sampler = buildSampler(mesh, bones, owners);
  sampleVertices(mesh, sampler);
  const headTopLocal = measureHeadTop(sampler, owners, bones.head);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < sampler.world.length; i += 3) {
    minY = Math.min(minY, sampler.world[i]);
    maxY = Math.max(maxY, sampler.world[i]);
  }

  const capsules = buildCapsules(mesh, bones, sampler, owners, headTopLocal);

  return {
    root,
    model,
    mesh,
    bones,
    neutralLocal,
    neutralWorld,
    neutralPosition,
    dirs,
    palmNormal,
    radial,
    headTopLocal,
    sampler,
    capsules,
    standingHeight: maxY - minY,
    seatHeight: 0, // set by the solver after solving the seated base pose
  };
}

type BoneGroup = Set<number>;

/**
 * The mapped joint each skeleton bone belongs to: the bone itself when it is
 * mapped, otherwise its nearest mapped ancestor. The CC4 skin is weighted to
 * helper bones (Pelvis, thigh and forearm twist, share bones, fingers, toes),
 * and this is how their vertices end up in the right contact group and capsule.
 */
function jointOwners(mesh: SkinnedMesh, bones: Record<RigJoint, Bone>): Array<RigJoint | null> {
  const byBone = new Map<Object3D, RigJoint>();
  for (const [joint, bone] of Object.entries(bones) as Array<[RigJoint, Bone]>) byBone.set(bone, joint);
  return mesh.skeleton.bones.map((bone) => {
    for (let node: Object3D | null = bone; node; node = node.parent) {
      const joint = byBone.get(node);
      if (joint) return joint;
    }
    return null;
  });
}

/** Skeleton indices whose owner is one of `joints`. */
function bonesOwnedBy(owners: Array<RigJoint | null>, joints: readonly RigJoint[]): BoneGroup {
  const wanted = new Set<RigJoint>(joints);
  const set: BoneGroup = new Set();
  owners.forEach((owner, index) => {
    if (owner && wanted.has(owner)) set.add(index);
  });
  return set;
}

/** Index of the heaviest bone of vertex `v` in a 4-influence skin. */
function dominantBone(skinIndex: ArrayLike<number>, skinWeight: ArrayLike<number>, v: number) {
  let best = 0;
  let bestWeight = -1;
  for (let k = 0; k < 4; k++) {
    const weight = skinWeight[v * 4 + k];
    if (weight > bestWeight) {
      bestWeight = weight;
      best = skinIndex[v * 4 + k];
    }
  }
  return { bone: best, weight: bestWeight };
}

/**
 * Crown of the head in Head bone local space, measured from the skin so it fits
 * the model: the centre of the head vertices within 1 cm of the highest one.
 */
function measureHeadTop(sampler: VertexSampler, owners: Array<RigJoint | null>, head: Bone) {
  const w = sampler.world;
  const crown: number[] = [];
  let top = -Infinity;
  for (let i = 0; i < sampler.indices.length; i++) {
    const { bone } = dominantBone(sampler.joints, sampler.weights, i);
    if (owners[bone] !== "head") continue;
    crown.push(i);
    top = Math.max(top, w[i * 3 + 1]);
  }
  const point = new Vector3();
  let count = 0;
  for (const i of crown) {
    if (w[i * 3 + 1] < top - 0.01) continue;
    point.x += w[i * 3];
    point.y += w[i * 3 + 1];
    point.z += w[i * 3 + 2];
    count++;
  }
  if (count === 0) throw new Error("No head vertices found to measure the head top.");
  return head.worldToLocal(point.multiplyScalar(1 / count));
}

function buildSampler(mesh: SkinnedMesh, bones: Record<RigJoint, Bone>, owners: Array<RigJoint | null>): VertexSampler {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;

  const handBones = bonesOwnedBy(owners, ["handL", "middleL", "indexL", "pinkyL", "handR", "middleR", "indexR", "pinkyR"]);
  const ballBones = bonesOwnedBy(owners, ["ballL", "ballLeafL", "ballR", "ballLeafR"]);
  const footBones = new Set([...bonesOwnedBy(owners, ["footL", "footR"]), ...ballBones]);
  const trunkBones = bonesOwnedBy(owners, [
    "pelvis", "spine1", "spine2", "spine3", "neck", "head", "clavicleL", "clavicleR",
  ]);
  const thighBones = bonesOwnedBy(owners, ["thighL", "thighR"]);
  const calfBones = bonesOwnedBy(owners, ["calfL", "calfR"]);

  const dominant = (v: number) => {
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k);
      if (w > bestW) {
        bestW = w;
        best = skinIndex.getComponent(v, k);
      }
    }
    return best;
  };

  const chosen: number[] = [];
  for (let v = 0; v < position.count; v++) {
    const bone = dominant(v);
    if (handBones.has(bone) || footBones.has(bone) || v % 3 === 0) chosen.push(v);
  }

  const n = chosen.length;
  const indices = Uint32Array.from(chosen);
  const base = new Float32Array(n * 3);
  const joints = new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    const v = indices[i];
    p.fromBufferAttribute(position, v).applyMatrix4(mesh.bindMatrix);
    base[i * 3] = p.x;
    base[i * 3 + 1] = p.y;
    base[i * 3 + 2] = p.z;
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = skinIndex.getComponent(v, k);
      weights[i * 4 + k] = skinWeight.getComponent(v, k);
    }
  }

  const sampler: VertexSampler = {
    indices,
    base,
    joints,
    weights,
    world: new Float32Array(n * 3),
    groups: {} as VertexSampler["groups"],
  };
  sampleVertices(mesh, sampler);

  const kneeL = worldPos(bones.calfL);
  const kneeR = worldPos(bones.calfR);
  const ankleZ = (worldPos(bones.footL).z + worldPos(bones.footR).z) / 2;
  const hipY = worldPos(bones.thighL).y;
  const groups: Record<ContactGroup, number[]> = {
    all: [],
    heels: [],
    toes: [],
    feet: [],
    hands: [],
    knees: [],
    seat: [],
    back: [],
    front: [],
  };
  const w = sampler.world;
  for (let i = 0; i < n; i++) {
    const bone = dominant(indices[i]);
    const x = w[i * 3];
    const y = w[i * 3 + 1];
    const z = w[i * 3 + 2];
    groups.all.push(i);
    if (footBones.has(bone)) {
      groups.feet.push(i);
      if (ballBones.has(bone)) groups.toes.push(i);
      else if (z < ankleZ + 0.02) groups.heels.push(i);
    }
    if (handBones.has(bone)) groups.hands.push(i);
    const nearKnee =
      Math.hypot(x - kneeL.x, y - kneeL.y, z - kneeL.z) < 0.12 ||
      Math.hypot(x - kneeR.x, y - kneeR.y, z - kneeR.z) < 0.12;
    if ((calfBones.has(bone) || thighBones.has(bone)) && nearKnee) groups.knees.push(i);
    if (trunkBones.has(bone) || (thighBones.has(bone) && y > hipY - 0.3)) groups.seat.push(i);
    if (trunkBones.has(bone)) {
      groups.back.push(i);
      groups.front.push(i);
    }
    if (thighBones.has(bone)) groups.front.push(i);
  }
  for (const key of Object.keys(groups) as ContactGroup[]) {
    sampler.groups[key] = Uint32Array.from(groups[key]);
  }
  return sampler;
}

const skinMatrices: Matrix4[] = [];
const toWorld = new Matrix4();

/** CPU skinning of the sampled vertices into world space. */
export function sampleVertices(mesh: SkinnedMesh, sampler: VertexSampler) {
  const skeleton = mesh.skeleton;
  const bones = skeleton.bones;
  for (let b = 0; b < bones.length; b++) {
    if (!skinMatrices[b]) skinMatrices[b] = new Matrix4();
    skinMatrices[b].multiplyMatrices(bones[b].matrixWorld, skeleton.boneInverses[b]);
  }
  toWorld.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  const { base, joints, weights, world } = sampler;
  const n = sampler.indices.length;
  const t = toWorld.elements;
  for (let i = 0; i < n; i++) {
    const bx = base[i * 3];
    const by = base[i * 3 + 1];
    const bz = base[i * 3 + 2];
    let x = 0;
    let y = 0;
    let z = 0;
    for (let k = 0; k < 4; k++) {
      const weight = weights[i * 4 + k];
      if (weight === 0) continue;
      const e = skinMatrices[joints[i * 4 + k]].elements;
      x += (e[0] * bx + e[4] * by + e[8] * bz + e[12]) * weight;
      y += (e[1] * bx + e[5] * by + e[9] * bz + e[13]) * weight;
      z += (e[2] * bx + e[6] * by + e[10] * bz + e[14]) * weight;
    }
    world[i * 3] = t[0] * x + t[4] * y + t[8] * z + t[12];
    world[i * 3 + 1] = t[1] * x + t[5] * y + t[9] * z + t[13];
    world[i * 3 + 2] = t[2] * x + t[6] * y + t[10] * z + t[14];
  }
}

/** Lowest sampled vertex of a contact group, in world space. */
export function groupLowest(sampler: VertexSampler, group: ContactGroup) {
  const list = sampler.groups[group];
  const w = sampler.world;
  let best = -1;
  let bestY = Infinity;
  for (let k = 0; k < list.length; k++) {
    const y = w[list[k] * 3 + 1];
    if (y < bestY) {
      bestY = y;
      best = list[k];
    }
  }
  if (best < 0) return null;
  return new Vector3(w[best * 3], w[best * 3 + 1], w[best * 3 + 2]);
}

function buildCapsules(
  mesh: SkinnedMesh,
  bones: Record<RigJoint, Bone>,
  sampler: VertexSampler,
  owners: Array<RigJoint | null>,
  headTopLocal: Vector3,
): CapsuleDef[] {
  const defs: Array<Omit<CapsuleDef, "radius"> & { fallback: number }> = [
    { id: "trunk", from: "pelvis", to: "neck", fallback: 0.13 },
    { id: "head", from: "neck", to: "headTop", fallback: 0.1 },
  ];
  for (const s of SIDE_KEYS) {
    defs.push(
      { id: `upperarm${s}` as CapsuleId, from: `upperarm${s}` as RigJoint, to: `lowerarm${s}` as RigJoint, fallback: 0.05 },
      { id: `forearm${s}` as CapsuleId, from: `lowerarm${s}` as RigJoint, to: `hand${s}` as RigJoint, fallback: 0.04 },
      { id: `hand${s}` as CapsuleId, from: `hand${s}` as RigJoint, to: `middle${s}` as RigJoint, fallback: 0.04 },
      { id: `thigh${s}` as CapsuleId, from: `thigh${s}` as RigJoint, to: `calf${s}` as RigJoint, fallback: 0.08 },
      { id: `shank${s}` as CapsuleId, from: `calf${s}` as RigJoint, to: `foot${s}` as RigJoint, fallback: 0.055 },
      { id: `foot${s}` as CapsuleId, from: `foot${s}` as RigJoint, to: `ballLeaf${s}` as RigJoint, fallback: 0.045 },
    );
  }

  // Radius: median distance of the joint's own vertices to its axis, shrunk so
  // the capsules sit inside the skin. A vertex belongs to the joint that owns its
  // heaviest bone, so twist and share bones count toward their limb.
  const w = sampler.world;
  const headTop = bones.head.localToWorld(headTopLocal.clone());
  return defs.map((def) => {
    const a = worldPos(bones[def.from]);
    const b = def.to === "headTop" ? headTop : worldPos(bones[def.to]);
    const distances: number[] = [];
    for (let i = 0; i < sampler.indices.length; i++) {
      const { bone, weight } = dominantBone(sampler.joints, sampler.weights, i);
      if (owners[bone] !== def.from || weight < 0.5) continue;
      const p = new Vector3(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]);
      distances.push(distanceToSegment(p, a, b));
    }
    distances.sort((x, y) => x - y);
    const median = distances.length > 8 ? distances[Math.floor(distances.length / 2)] : def.fallback;
    return { id: def.id, from: def.from, to: def.to, radius: Math.max(0.025, median * 0.8) };
  });
}

export function distanceToSegment(p: Vector3, a: Vector3, b: Vector3) {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Closest distance between two segments. */
export function segmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) return p1.distanceTo(p2);
  if (a <= 1e-9) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-9) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
