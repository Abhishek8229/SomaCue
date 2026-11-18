import { Quaternion, Vector3, type Bone } from "three";
import type { DofPose } from "./movement-spec";
import { ANTERIOR, LEFT, UP, lateralOf, medialOf, type BodyRig, type RigJoint, type SideKey } from "./rig";
import { DIRECTIONAL_AXIAL_DOFS, SEGMENT_MOTIONS, isAxial, type Dof, type Motion, type Segment } from "./vocabulary";

/*
 * Live joint angles measured on the posed 3D body.
 *
 * Every number comes from bone transforms: the rotation of one segment
 * relative to its neighbour, compared with the same relative rotation at the
 * exercise's start pose. A joint reads 0° at the start of each rep and its
 * full excursion at the peak, at any playback speed. The moving joints are
 * found by posing the body through the rep and keeping those that turn, so
 * nothing is hard-coded per exercise. The figure is a simulated reference
 * model, so these are the model's angles, not a measurement of the patient.
 */

export const MOVING_THRESHOLD_DEG = 3;
const RAD_TO_DEG = 180 / Math.PI;
const PEAK_SAMPLES = [0.25, 0.5, 0.75, 1];
/** L and R joints whose peaks differ by less than this share one label. */
const MERGE_TOLERANCE_DEG = 2;
/**
 * A joint the exercise does not prescribe, that only follows along (a resting
 * arm settling as the trunk moves), is labelled when it moves at least this
 * share of the exercise's largest joint excursion.
 */
export const FOLLOWER_SHARE = 0.3;
/** Degrees of freedom that turn a segment about its own long axis. */
const TWIST_DOFS: ReadonlySet<Dof> = new Set(["rot", "pron", "inv"]);

export type JointKind =
  | "pelvis"
  | "lumbar"
  | "thoracic"
  | "cervical"
  | "hip"
  | "knee"
  | "ankle"
  | "shoulder"
  | "scapula"
  | "elbow"
  | "wrist";

/**
 * Where a protractor arm points at the start pose: toward a joint from the
 * pivot, the body's anterior, or a midline direction (pelvis up, thorax down)
 * for arms whose pivot sits off the midline, so they lie in the plane of motion.
 */
type Toward = RigJoint | "headTop" | "hipMid" | "anterior" | "pelvisUp" | "thoraxDown";

type JointDef = {
  id: string;
  kind: JointKind;
  side: SideKey | null;
  /** null: the floor, for the pelvis */
  proximal: RigJoint | null;
  distal: RigJoint;
  pivot: RigJoint;
  /** where each arm of the protractor points at the start pose */
  proximalToward: Toward;
  distalToward: Toward;
  /** spec segments this joint shows, used for naming */
  segments: Segment[];
  /** protractor arm length in metres */
  ray: number;
};

const j = (name: string) => name as RigJoint;

function limbDefs(side: SideKey): JointDef[] {
  return [
    {
      id: `hip${side}`, kind: "hip", side, proximal: "pelvis", distal: j(`thigh${side}`), pivot: j(`thigh${side}`),
      proximalToward: "pelvisUp", distalToward: j(`calf${side}`), segments: ["hip"], ray: 0.297,
    },
    {
      id: `knee${side}`, kind: "knee", side, proximal: j(`thigh${side}`), distal: j(`calf${side}`), pivot: j(`calf${side}`),
      proximalToward: j(`thigh${side}`), distalToward: j(`foot${side}`), segments: ["knee"], ray: 0.27,
    },
    {
      id: `ankle${side}`, kind: "ankle", side, proximal: j(`calf${side}`), distal: j(`foot${side}`), pivot: j(`foot${side}`),
      proximalToward: j(`calf${side}`), distalToward: j(`ballLeaf${side}`), segments: ["ankle"], ray: 0.162,
    },
    {
      id: `scapula${side}`, kind: "scapula", side, proximal: "spine3", distal: j(`clavicle${side}`), pivot: j(`clavicle${side}`),
      proximalToward: "thoraxDown", distalToward: j(`upperarm${side}`), segments: ["scapula"], ray: 0.135,
    },
    {
      id: `shoulder${side}`, kind: "shoulder", side, proximal: "spine3", distal: j(`upperarm${side}`), pivot: j(`upperarm${side}`),
      proximalToward: "thoraxDown", distalToward: j(`lowerarm${side}`), segments: ["shoulder"], ray: 0.27,
    },
    {
      id: `elbow${side}`, kind: "elbow", side, proximal: j(`upperarm${side}`), distal: j(`lowerarm${side}`), pivot: j(`lowerarm${side}`),
      proximalToward: j(`upperarm${side}`), distalToward: j(`hand${side}`), segments: ["elbow", "forearm"], ray: 0.216,
    },
    {
      id: `wrist${side}`, kind: "wrist", side, proximal: j(`lowerarm${side}`), distal: j(`hand${side}`), pivot: j(`hand${side}`),
      proximalToward: j(`lowerarm${side}`), distalToward: j(`middle${side}`), segments: ["wrist"], ray: 0.122,
    },
  ];
}

export const JOINT_DEFS: JointDef[] = [
  {
    id: "pelvis", kind: "pelvis", side: null, proximal: null, distal: "pelvis", pivot: "pelvis",
    proximalToward: "anterior", distalToward: "anterior", segments: ["pelvis"], ray: 0.23,
  },
  {
    id: "lumbar", kind: "lumbar", side: null, proximal: "pelvis", distal: "spine2", pivot: "spine1",
    proximalToward: "hipMid", distalToward: "spine3", segments: ["lumbar"], ray: 0.23,
  },
  {
    id: "thoracic", kind: "thoracic", side: null, proximal: "spine2", distal: "spine3", pivot: "spine3",
    proximalToward: "spine1", distalToward: "neck", segments: ["thoracic"], ray: 0.216,
  },
  {
    id: "cervical", kind: "cervical", side: null, proximal: "spine3", distal: "head", pivot: "neck",
    proximalToward: "spine2", distalToward: "headTop", segments: ["cervical"], ray: 0.189,
  },
  ...limbDefs("L"),
  ...limbDefs("R"),
];

export type AngleName = { name: string; short: string };

export type TrackedJoint = {
  id: string;
  kind: JointKind;
  side: SideKey | null;
  /** the protractor's fixed arm rides on this bone (null: the floor) */
  fixed: Bone | null;
  /** the protractor's moving arm rides on this bone */
  moving: Bone;
  pivot: Bone;
  /** moving arm direction in the moving bone's frame */
  pointer: Vector3;
  /** the same arm at the start pose, in the fixed bone's frame */
  startPointer: Vector3;
  /** plane-of-motion normal in the fixed frame; a positive turn goes from start toward the peak */
  axis: Vector3;
  peakDegrees: number;
  label: AngleName;
  ray: number;
};

export type AngleLabel = {
  key: string;
  joints: string[];
  side: "L" | "R" | "L+R" | null;
  name: string;
  short: string;
  peakDegrees: number;
};

export type AngleTrack = { joints: TrackedJoint[]; labels: AngleLabel[] };

export type AngleReading = {
  id: string;
  /** angle between the start arm and the live arm */
  degrees: number;
  /** the same angle, signed about the plane normal (positive toward the peak) */
  signedDegrees: number;
  peakDegrees: number;
  pivot: Vector3;
  /** unit directions in world space */
  ref: Vector3;
  live: Vector3;
  normal: Vector3;
  ray: number;
};

/* Quaternion helpers */

function angleOf(q: Quaternion) {
  const n = q.clone().normalize();
  return 2 * Math.acos(Math.min(1, Math.abs(n.w))) * RAD_TO_DEG;
}

type Snap = { P: Quaternion; D: Quaternion };

const relative = (s: Snap) => s.P.clone().invert().multiply(s.D);
/** Rotation of the distal segment relative to the proximal one, from `start` to `now`, in the proximal frame. */
const excursion = (start: Snap, now: Snap) => relative(now).multiply(relative(start).invert());

function snapshot(rig: BodyRig, def: JointDef): Snap {
  return {
    P: def.proximal ? rig.bones[def.proximal].getWorldQuaternion(new Quaternion()) : new Quaternion(),
    D: rig.bones[def.distal].getWorldQuaternion(new Quaternion()),
  };
}

function towardDirection(rig: BodyRig, toward: Toward, arm: RigJoint | null, pivot: Vector3) {
  if (toward === "anterior") {
    if (!arm) return ANTERIOR.clone().applyQuaternion(rig.root.quaternion);
    const bone = rig.bones[arm];
    const neutral = rig.neutralWorld.get(bone) ?? new Quaternion();
    // The bone's own anterior: its accumulated body rotation applied to the body's anterior.
    return ANTERIOR.clone().applyQuaternion(neutral.clone().invert()).applyQuaternion(bone.getWorldQuaternion(new Quaternion()));
  }
  const world = (joint: RigJoint) => rig.bones[joint].getWorldPosition(new Vector3());
  const hipMid = () => world("thighL").add(world("thighR")).multiplyScalar(0.5);
  if (toward === "pelvisUp") return world("spine1").sub(hipMid()).normalize();
  if (toward === "thoraxDown") return world("spine1").sub(world("spine3")).normalize();
  const point =
    toward === "headTop"
      ? rig.headTopLocal.clone().applyMatrix4(rig.bones.head.matrixWorld)
      : toward === "hipMid"
        ? hipMid()
        : world(toward);
  const dir = point.sub(pivot);
  return dir.lengthSq() > 1e-10 ? dir.normalize() : ANTERIOR.clone();
}

/** The first candidate with a clear component across the axis, flattened onto the plane of motion. */
function perpendicularPointer(axis: Vector3, candidates: Vector3[]) {
  let best: Vector3 | null = null;
  for (const candidate of candidates) {
    const flat = candidate.clone().addScaledVector(axis, -candidate.dot(axis));
    if (flat.length() > 0.45) return flat.normalize();
    if (!best || flat.lengthSq() > best.lengthSq()) best = flat;
  }
  if (best && best.lengthSq() > 1e-8) return best.normalize();
  const fallback = Math.abs(axis.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return fallback.addScaledVector(axis, -fallback.dot(axis)).normalize();
}

/* Naming */

const SEGMENT_TEXT: Record<Segment, [string, string]> = {
  cervical: ["Neck", "Neck"],
  thoracic: ["Thoracic", "Thoracic"],
  lumbar: ["Lumbar", "Lumbar"],
  pelvis: ["Pelvic", "Pelvic"],
  scapula: ["Shoulder blade", "Scapula"],
  shoulder: ["Shoulder", "Shoulder"],
  elbow: ["Elbow", "Elbow"],
  forearm: ["Forearm", "Forearm"],
  wrist: ["Wrist", "Wrist"],
  hip: ["Hip", "Hip"],
  knee: ["Knee", "Knee"],
  ankle: ["Ankle", "Ankle"],
};

const MOTION_TEXT: Record<Motion, [string, string]> = {
  flexion: ["flexion", "flex."],
  extension: ["extension", "ext."],
  lateral_flexion: ["side bend", "side bend"],
  rotation: ["rotation", "rot."],
  retraction: ["retraction", "retract."],
  anterior_tilt: ["anterior tilt", "ant. tilt"],
  posterior_tilt: ["posterior tilt", "post. tilt"],
  elevation: ["elevation", "elev."],
  depression: ["depression", "depress."],
  protraction: ["protraction", "protract."],
  abduction: ["abduction", "abd."],
  adduction: ["adduction", "add."],
  horizontal_abduction: ["horizontal abduction", "horiz. abd."],
  horizontal_adduction: ["horizontal adduction", "horiz. add."],
  internal_rotation: ["internal rotation", "int. rot."],
  external_rotation: ["external rotation", "ext. rot."],
  pronation: ["pronation", "pron."],
  supination: ["supination", "sup."],
  radial_deviation: ["radial deviation", "rad. dev."],
  ulnar_deviation: ["ulnar deviation", "uln. dev."],
  dorsiflexion: ["dorsiflexion", "dorsiflex."],
  plantarflexion: ["plantarflexion", "plantarflex."],
  inversion: ["inversion", "inv."],
  eversion: ["eversion", "ev."],
};

export function angleName(segment: Segment, motion: Motion, direction?: "left" | "right"): AngleName {
  if (segment === "pelvis" && (motion === "anterior_tilt" || motion === "posterior_tilt")) {
    const anterior = motion === "anterior_tilt";
    return {
      name: anterior ? "Anterior pelvic tilt" : "Posterior pelvic tilt",
      short: anterior ? "Ant. pelvic tilt" : "Post. pelvic tilt",
    };
  }
  const [segmentLong, segmentShort] = SEGMENT_TEXT[segment];
  const [motionLong, motionShort] = MOTION_TEXT[motion];
  const long = direction ? ` ${direction}` : "";
  const short = direction ? ` ${direction === "left" ? "L" : "R"}` : "";
  return { name: `${segmentLong} ${motionLong}${long}`, short: `${segmentShort} ${motionShort}${short}` };
}

/** Name from the prescription: the dof of this joint that changes most between the start and end pose. */
function specName(def: JointDef, dofs: { start: DofPose; end: DofPose }, mode: "swing" | "twist"): AngleName | null {
  const sideKey = def.side ?? "C";
  let best: { segment: Segment; dof: Dof; delta: number } | null = null;
  for (const segment of def.segments) {
    const seen = new Set<Dof>();
    for (const mapping of Object.values(SEGMENT_MOTIONS[segment])) {
      if (!mapping || seen.has(mapping.dof)) continue;
      if (TWIST_DOFS.has(mapping.dof) !== (mode === "twist")) continue;
      seen.add(mapping.dof);
      const key = `${segment}.${sideKey}.${mapping.dof}`;
      const delta = (dofs.end[key] ?? 0) - (dofs.start[key] ?? 0);
      if (Math.abs(delta) >= 1 && (!best || Math.abs(delta) > Math.abs(best.delta))) best = { segment, dof: mapping.dof, delta };
    }
  }
  if (!best) return null;
  const entries = Object.entries(SEGMENT_MOTIONS[best.segment]) as Array<[Motion, { dof: Dof; sign: 1 | -1 }]>;
  if (isAxial(best.segment) && DIRECTIONAL_AXIAL_DOFS.has(best.dof)) {
    const motion = entries.find(([, mapping]) => mapping.dof === best.dof)?.[0];
    return motion ? angleName(best.segment, motion, best.delta > 0 ? "left" : "right") : null;
  }
  const sign = best.delta > 0 ? 1 : -1;
  const motion = entries.find(([, mapping]) => mapping.dof === best.dof && mapping.sign === sign)?.[0];
  return motion ? angleName(best.segment, motion) : null;
}

type Plane = { axis: Vector3; positive: AngleName; negative: AngleName };

const unit = (v: Vector3) => v.clone().normalize();
const cross = (a: Vector3, b: Vector3) => new Vector3().crossVectors(a, b).normalize();
const DOWN = UP.clone().negate();
const BACKWARD = ANTERIOR.clone().negate();
const NEG_Z = new Vector3(0, 0, -1);

function plane(axis: Vector3, segment: Segment, positive: Motion, negative: Motion): Plane {
  return { axis, positive: angleName(segment, positive), negative: angleName(segment, negative) };
}

function directional(axis: Vector3, segment: Segment, motion: Motion): Plane {
  return { axis, positive: angleName(segment, motion, "left"), negative: angleName(segment, motion, "right") };
}

/**
 * Anatomical axes of each joint, in the body frame of the proximal segment.
 * They are built the same way the solver builds each motion, so a positive
 * turn about an axis is the first-named motion.
 */
function planesFor(rig: BodyRig, def: JointDef): Plane[] {
  const s = def.side ?? "L";
  const lateral = lateralOf(s);
  const medial = medialOf(s);
  const d = rig.dirs;
  switch (def.kind) {
    case "pelvis":
      return [
        plane(unit(LEFT), "pelvis", "anterior_tilt", "posterior_tilt"),
        { axis: NEG_Z.clone(), positive: { name: "Pelvic obliquity", short: "Pelvic obliq." }, negative: { name: "Pelvic obliquity", short: "Pelvic obliq." } },
        directional(unit(UP), "pelvis", "rotation"),
      ];
    case "lumbar":
    case "thoracic":
    case "cervical":
      return [
        plane(unit(LEFT), def.kind, "flexion", "extension"),
        directional(NEG_Z.clone(), def.kind, "lateral_flexion"),
        directional(unit(UP), def.kind, "rotation"),
      ];
    case "hip":
      return [
        plane(cross(d.thigh[s], ANTERIOR), "hip", "flexion", "extension"),
        plane(cross(d.thigh[s], lateral), "hip", "abduction", "adduction"),
        plane(cross(ANTERIOR, medial), "hip", "internal_rotation", "external_rotation"),
      ];
    case "knee":
      return [plane(cross(d.shank[s], BACKWARD), "knee", "flexion", "extension")];
    case "ankle":
      return [
        plane(cross(d.foot[s], UP), "ankle", "dorsiflexion", "plantarflexion"),
        plane(cross(DOWN, medial), "ankle", "inversion", "eversion"),
      ];
    case "shoulder":
      return [
        plane(cross(DOWN, ANTERIOR), "shoulder", "flexion", "extension"),
        plane(cross(DOWN, lateral), "shoulder", "abduction", "adduction"),
        plane(cross(ANTERIOR, medial), "shoulder", "internal_rotation", "external_rotation"),
      ];
    case "scapula":
      return [
        plane(cross(d.clavicle[s], UP), "scapula", "elevation", "depression"),
        plane(cross(d.clavicle[s], ANTERIOR), "scapula", "protraction", "retraction"),
      ];
    case "elbow":
      return [
        plane(cross(d.forearm[s], ANTERIOR), "elbow", "flexion", "extension"),
        plane(cross(medial, BACKWARD), "forearm", "pronation", "supination"),
      ];
    case "wrist":
      return [
        plane(cross(d.hand[s], rig.palmNormal[s]), "wrist", "flexion", "extension"),
        plane(cross(d.hand[s], rig.radial[s]), "wrist", "radial_deviation", "ulnar_deviation"),
      ];
  }
}

/** Name from the measured rotation: the anatomical axis it turns about most. */
function geometricName(rig: BodyRig, def: JointDef, rotation: Vector3): AngleName {
  let best: { plane: Plane; component: number } | null = null;
  for (const candidate of planesFor(rig, def)) {
    const component = rotation.dot(candidate.axis);
    if (!best || Math.abs(component) > Math.abs(best.component)) best = { plane: candidate, component };
  }
  if (!best) return { name: SEGMENT_TEXT[def.segments[0]][0], short: SEGMENT_TEXT[def.segments[0]][1] };
  return best.component >= 0 ? best.plane.positive : best.plane.negative;
}

/* Tracking */

/** Poses the rig at a share of the rep (0 start pose, 1 peak), the way the engine does. */
export type PoseAtProgress = (progress: number) => void;

/** Joints of the arm. A resting arm settles passively and is not the exercise. */
const ARM_KINDS: ReadonlySet<JointKind> = new Set(["shoulder", "scapula", "elbow", "wrist"]);

export type TrackOptions = {
  /**
   * Sides whose arm the solver only rests on the floor (the exercise does not
   * use it). Such an arm gets no protractor unless the exercise prescribes it.
   */
  passiveArms?: readonly SideKey[];
};

/**
 * Finds the joints that move during one rep and sets up a protractor for
 * each. Leaves the rig posed at the peak; the caller re-poses it.
 */
export function buildAngleTrack(
  rig: BodyRig,
  poseAtProgress: PoseAtProgress,
  dofs: { start: DofPose; end: DofPose },
  options: TrackOptions = {},
): AngleTrack {
  const passiveArms = new Set(options.passiveArms ?? []);
  poseAtProgress(0);
  rig.root.updateMatrixWorld(true);
  const rootStart = rig.root.quaternion.clone();
  const starts = JOINT_DEFS.map((def) => snapshot(rig, def));
  const hints = JOINT_DEFS.map((def) => {
    const pivot = rig.bones[def.pivot].getWorldPosition(new Vector3());
    return {
      proximal: towardDirection(rig, def.proximalToward, def.proximal, pivot),
      distal: towardDirection(rig, def.distalToward, def.distal, pivot),
    };
  });

  const peaks = starts.map((start) => ({ degrees: 0, snap: start }));
  for (const progress of PEAK_SAMPLES) {
    poseAtProgress(progress);
    rig.root.updateMatrixWorld(true);
    JOINT_DEFS.forEach((def, i) => {
      const now = snapshot(rig, def);
      const degrees = angleOf(excursion(starts[i], now));
      if (degrees > peaks[i].degrees) peaks[i] = { degrees, snap: now };
    });
  }

  const joints: TrackedJoint[] = [];
  const largest = Math.max(0, ...peaks.map((peak) => peak.degrees));
  JOINT_DEFS.forEach((def, i) => {
    if (peaks[i].degrees < MOVING_THRESHOLD_DEG) return;
    const start = starts[i];
    const peak = peaks[i].snap;

    // Draw the arm on whichever segment visibly turns: when the pelvis rocks
    // under a still spine, the lumbar protractor's moving arm is the pelvis.
    const proximalTurn = def.proximal ? angleOf(peak.P.clone().multiply(start.P.clone().invert())) : 0;
    const distalTurn = angleOf(peak.D.clone().multiply(start.D.clone().invert()));
    const proximalMoves = def.proximal !== null && proximalTurn > distalTurn + 0.5;
    const F0 = proximalMoves ? start.D : start.P;
    const M0 = proximalMoves ? start.P : start.D;
    const Fp = proximalMoves ? peak.D : peak.P;
    const Mp = proximalMoves ? peak.P : peak.D;
    const Q0 = F0.clone().invert().multiply(M0);
    const Qp = Fp.clone().invert().multiply(Mp);
    const turn = Qp.clone().multiply(Q0.clone().invert());

    // Swing and twist, the way a goniometer reads a joint: the angle the
    // segment's long axis swings through, or, for a joint that only turns
    // about its long axis (neck or trunk rotation), the twist about it.
    const F0inverse = F0.clone().invert();
    const longAxis = (proximalMoves ? hints[i].proximal : hints[i].distal).clone().applyQuaternion(F0inverse).normalize();
    const longAtPeak = longAxis.clone().applyQuaternion(turn);
    const swing = Math.acos(Math.min(1, Math.max(-1, longAxis.dot(longAtPeak)))) * RAD_TO_DEG;
    // A joint that turns mostly about its own long axis is read as a twist.
    const total = angleOf(turn);
    const mode: "swing" | "twist" = swing >= Math.max(MOVING_THRESHOLD_DEG, 0.5 * total) ? "swing" : "twist";

    let axis: Vector3;
    let startPointer: Vector3;
    if (mode === "swing") {
      axis = new Vector3().crossVectors(longAxis, longAtPeak).normalize();
      startPointer = longAxis;
    } else {
      axis = longAxis;
      startPointer = perpendicularPointer(
        axis,
        [ANTERIOR, UP, LEFT].map((v) => v.clone().applyQuaternion(rootStart).applyQuaternion(F0inverse)),
      );
    }
    const pointer = startPointer.clone().applyQuaternion(Q0.clone().invert());
    const peakRef = startPointer.clone().applyQuaternion(Fp);
    const peakLive = pointer.clone().applyQuaternion(Mp);
    const peakDegrees = Math.acos(Math.min(1, Math.max(-1, peakRef.dot(peakLive)))) * RAD_TO_DEG;
    if (peakDegrees < MOVING_THRESHOLD_DEG) return;

    // Name what is measured, in the usual convention (distal relative to proximal).
    const prescribed = specName(def, dofs, mode);
    if (!prescribed && def.side && passiveArms.has(def.side) && ARM_KINDS.has(def.kind)) return;
    if (!prescribed && peakDegrees < FOLLOWER_SHARE * largest) return;
    const toBody = def.proximal
      ? (rig.neutralWorld.get(rig.bones[def.proximal]) ?? new Quaternion())
      : rootStart.clone().invert();
    // The measured rotation in the fixed frame, flipped when the arms were swapped.
    const sign = proximalMoves ? -1 : 1;
    const fixedToProximal = proximalMoves ? Q0.clone().invert() : new Quaternion();
    const rotation = axis
      .clone()
      .applyQuaternion(fixedToProximal)
      .applyQuaternion(toBody)
      .multiplyScalar(sign * peakDegrees);
    const label = prescribed ?? geometricName(rig, def, rotation);

    joints.push({
      id: def.id,
      kind: def.kind,
      side: def.side,
      fixed: proximalMoves ? rig.bones[def.distal] : def.proximal ? rig.bones[def.proximal] : null,
      moving: proximalMoves ? rig.bones[def.proximal as RigJoint] : rig.bones[def.distal],
      pivot: rig.bones[def.pivot],
      pointer,
      startPointer,
      axis,
      peakDegrees,
      label,
      ray: def.ray,
    });
  });

  return { joints, labels: buildLabels(joints) };
}

/** One label per joint, with matching L and R joints combined. */
function buildLabels(joints: TrackedJoint[]): AngleLabel[] {
  const labels: AngleLabel[] = [];
  const used = new Set<string>();
  for (const joint of joints) {
    if (used.has(joint.id)) continue;
    used.add(joint.id);
    if (joint.side) {
      const otherSide = joint.side === "L" ? "R" : "L";
      const twin = joints.find(
        (other) =>
          other.kind === joint.kind &&
          other.side === otherSide &&
          !used.has(other.id) &&
          other.label.name === joint.label.name &&
          Math.abs(other.peakDegrees - joint.peakDegrees) < MERGE_TOLERANCE_DEG,
      );
      if (twin) {
        used.add(twin.id);
        labels.push({
          key: joint.kind,
          joints: [joint.id, twin.id],
          side: "L+R",
          name: joint.label.name,
          short: joint.label.short,
          peakDegrees: Math.max(joint.peakDegrees, twin.peakDegrees),
        });
        continue;
      }
    }
    labels.push({
      key: joint.id,
      joints: [joint.id],
      side: joint.side,
      name: joint.label.name,
      short: joint.label.short,
      peakDegrees: joint.peakDegrees,
    });
  }
  return labels.sort((a, b) => b.peakDegrees - a.peakDegrees || a.key.localeCompare(b.key));
}

/** Reads every tracked joint from the rig as it is posed now. */
export function measureAngles(track: AngleTrack): AngleReading[] {
  return track.joints.map((joint) => {
    const fixed = joint.fixed ? joint.fixed.getWorldQuaternion(new Quaternion()) : new Quaternion();
    const moving = joint.moving.getWorldQuaternion(new Quaternion());
    const ref = joint.startPointer.clone().applyQuaternion(fixed).normalize();
    const live = joint.pointer.clone().applyQuaternion(moving).normalize();
    const normal = joint.axis.clone().applyQuaternion(fixed).normalize();
    const dot = Math.min(1, Math.max(-1, ref.dot(live)));
    const signed = Math.atan2(new Vector3().crossVectors(ref, live).dot(normal), dot);
    return {
      id: joint.id,
      degrees: Math.acos(dot) * RAD_TO_DEG,
      signedDegrees: signed * RAD_TO_DEG,
      peakDegrees: joint.peakDegrees,
      pivot: joint.pivot.getWorldPosition(new Vector3()),
      ref,
      live,
      normal,
      ray: joint.ray,
    };
  });
}

export type AngleSummaryItem = {
  key: string;
  side: AngleLabel["side"];
  name: string;
  short: string;
  degrees: number;
};

/** One value per label: the larger of its joints, so a combined L+R label never hides the bigger side. */
export function labelDegrees(label: AngleLabel, readings: AngleReading[]) {
  let degrees = 0;
  for (const reading of readings) if (label.joints.includes(reading.id)) degrees = Math.max(degrees, reading.degrees);
  return degrees;
}

export function summarizeAngles(track: AngleTrack, readings: AngleReading[]): AngleSummaryItem[] {
  return track.labels.map((label) => ({
    key: label.key,
    side: label.side,
    name: label.name,
    short: label.short,
    degrees: Math.round(labelDegrees(label, readings)),
  }));
}
