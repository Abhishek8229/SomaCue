/**
 * The textbook vocabulary the AI may use to describe an exercise.
 * Everything the 3D figure does is composed from these terms. Pure data, no
 * three.js, so it is shared by the server, the browser and the tests.
 */

export const POSTURES = ["standing", "seated", "supine", "prone", "quadruped"] as const;
export type Posture = (typeof POSTURES)[number];

export const AXIAL_SEGMENTS = ["cervical", "thoracic", "lumbar", "pelvis"] as const;
export const LIMB_SEGMENTS = [
  "scapula",
  "shoulder",
  "elbow",
  "forearm",
  "wrist",
  "hip",
  "knee",
  "ankle",
] as const;
export const SEGMENTS = [...AXIAL_SEGMENTS, ...LIMB_SEGMENTS] as const;
export type AxialSegment = (typeof AXIAL_SEGMENTS)[number];
export type LimbSegment = (typeof LIMB_SEGMENTS)[number];
export type Segment = (typeof SEGMENTS)[number];

export const MOTIONS = [
  "flexion",
  "extension",
  "lateral_flexion",
  "rotation",
  "retraction",
  "anterior_tilt",
  "posterior_tilt",
  "elevation",
  "depression",
  "protraction",
  "abduction",
  "adduction",
  "horizontal_abduction",
  "horizontal_adduction",
  "internal_rotation",
  "external_rotation",
  "pronation",
  "supination",
  "radial_deviation",
  "ulnar_deviation",
  "dorsiflexion",
  "plantarflexion",
  "inversion",
  "eversion",
] as const;
export type Motion = (typeof MOTIONS)[number];

/** For limbs: which limb. For axial lateral flexion and rotation: the direction. */
export const SIDES = ["left", "right", "both"] as const;
export type Side = (typeof SIDES)[number];

export const PINS = ["left_hand", "right_hand", "left_foot", "right_foot"] as const;
export type Pin = (typeof PINS)[number];

export const REGIONS = [
  "head",
  "cervical",
  "thoracic",
  "lumbar",
  "pelvis",
  "shoulder_left",
  "shoulder_right",
  "elbow_left",
  "elbow_right",
  "wrist_hand_left",
  "wrist_hand_right",
  "hip_left",
  "hip_right",
  "knee_left",
  "knee_right",
  "ankle_foot_left",
  "ankle_foot_right",
] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  head: "Head",
  cervical: "Neck",
  thoracic: "Upper back",
  lumbar: "Lower back",
  pelvis: "Pelvis",
  shoulder_left: "Left shoulder",
  shoulder_right: "Right shoulder",
  elbow_left: "Left elbow",
  elbow_right: "Right elbow",
  wrist_hand_left: "Left wrist and hand",
  wrist_hand_right: "Right wrist and hand",
  hip_left: "Left hip",
  hip_right: "Right hip",
  knee_left: "Left knee",
  knee_right: "Right knee",
  ankle_foot_left: "Left ankle and foot",
  ankle_foot_right: "Right ankle and foot",
};

export const POSTURE_LABELS: Record<Posture, string> = {
  standing: "Standing",
  seated: "Seated",
  supine: "Lying on the back",
  prone: "Lying face down",
  quadruped: "Hands and knees",
};

/** Degrees of freedom the solver drives for each segment. */
export type Dof =
  | "flex"
  | "lat"
  | "rot"
  | "retract"
  | "tilt"
  | "elev"
  | "protr"
  | "abd"
  | "horiz"
  | "pron"
  | "dev"
  | "dorsi"
  | "inv";

type DofMapping = { dof: Dof; sign: 1 | -1 };

/**
 * Which motions each segment allows, and the signed degree of freedom each
 * motion drives. Extension, adduction, external rotation and so on are the
 * negative direction of the same axis.
 */
export const SEGMENT_MOTIONS: Record<Segment, Partial<Record<Motion, DofMapping>>> = {
  cervical: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
    lateral_flexion: { dof: "lat", sign: 1 },
    rotation: { dof: "rot", sign: 1 },
    retraction: { dof: "retract", sign: 1 },
  },
  thoracic: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
    lateral_flexion: { dof: "lat", sign: 1 },
    rotation: { dof: "rot", sign: 1 },
  },
  lumbar: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
    lateral_flexion: { dof: "lat", sign: 1 },
    rotation: { dof: "rot", sign: 1 },
  },
  pelvis: {
    anterior_tilt: { dof: "tilt", sign: 1 },
    posterior_tilt: { dof: "tilt", sign: -1 },
  },
  scapula: {
    elevation: { dof: "elev", sign: 1 },
    depression: { dof: "elev", sign: -1 },
    protraction: { dof: "protr", sign: 1 },
    retraction: { dof: "protr", sign: -1 },
  },
  shoulder: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
    abduction: { dof: "abd", sign: 1 },
    adduction: { dof: "abd", sign: -1 },
    horizontal_adduction: { dof: "horiz", sign: 1 },
    horizontal_abduction: { dof: "horiz", sign: -1 },
    internal_rotation: { dof: "rot", sign: 1 },
    external_rotation: { dof: "rot", sign: -1 },
  },
  elbow: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
  },
  forearm: {
    pronation: { dof: "pron", sign: 1 },
    supination: { dof: "pron", sign: -1 },
  },
  wrist: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
    radial_deviation: { dof: "dev", sign: 1 },
    ulnar_deviation: { dof: "dev", sign: -1 },
  },
  hip: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
    abduction: { dof: "abd", sign: 1 },
    adduction: { dof: "abd", sign: -1 },
    internal_rotation: { dof: "rot", sign: 1 },
    external_rotation: { dof: "rot", sign: -1 },
  },
  knee: {
    flexion: { dof: "flex", sign: 1 },
    extension: { dof: "flex", sign: -1 },
  },
  ankle: {
    dorsiflexion: { dof: "dorsi", sign: 1 },
    plantarflexion: { dof: "dorsi", sign: -1 },
    inversion: { dof: "inv", sign: 1 },
    eversion: { dof: "inv", sign: -1 },
  },
};

/** Axial degrees of freedom whose direction comes from the side (left is positive). */
export const DIRECTIONAL_AXIAL_DOFS: ReadonlySet<Dof> = new Set(["lat", "rot"]);

export function isAxial(segment: Segment): segment is AxialSegment {
  return (AXIAL_SEGMENTS as readonly string[]).includes(segment);
}

export function motionMapping(segment: Segment, motion: Motion): DofMapping | undefined {
  return SEGMENT_MOTIONS[segment][motion];
}

/** Anatomical plane of each motion, for display and for safety rules. */
export const MOTION_PLANE: Record<Motion, "sagittal" | "frontal" | "transverse"> = {
  flexion: "sagittal",
  extension: "sagittal",
  lateral_flexion: "frontal",
  rotation: "transverse",
  retraction: "sagittal",
  anterior_tilt: "sagittal",
  posterior_tilt: "sagittal",
  elevation: "frontal",
  depression: "frontal",
  protraction: "transverse",
  abduction: "frontal",
  adduction: "frontal",
  horizontal_abduction: "transverse",
  horizontal_adduction: "transverse",
  internal_rotation: "transverse",
  external_rotation: "transverse",
  pronation: "transverse",
  supination: "transverse",
  radial_deviation: "frontal",
  ulnar_deviation: "frontal",
  dorsiflexion: "sagittal",
  plantarflexion: "sagittal",
  inversion: "frontal",
  eversion: "frontal",
};

/** The region a segment belongs to, per side. */
export function regionsForSegment(segment: Segment, side: Side | undefined): Region[] {
  switch (segment) {
    case "cervical":
      return ["cervical"];
    case "thoracic":
      return ["thoracic"];
    case "lumbar":
      return ["lumbar"];
    case "pelvis":
      return ["pelvis"];
    default: {
      const base =
        segment === "scapula" || segment === "shoulder"
          ? "shoulder"
          : segment === "elbow"
            ? "elbow"
            : segment === "forearm" || segment === "wrist"
              ? "wrist_hand"
              : segment === "hip"
                ? "hip"
                : segment === "knee"
                  ? "knee"
                  : "ankle_foot";
      const sides = side === "left" ? ["left"] : side === "right" ? ["right"] : ["left", "right"];
      return sides.map((s) => `${base}_${s}` as Region);
    }
  }
}

export function formatMotion(motion: Motion) {
  return motion.replaceAll("_", " ");
}
