import type { AngleEntry } from "./movement-spec";
import type { ContactGroup } from "./rig";
import type { Posture } from "./vocabulary";

export type PostureDef = {
  /** rotation of the whole body about the left (+X) axis, degrees */
  pitchDeg: number;
  /** relaxed pose held unless the exercise overrides it */
  base: AngleEntry[];
  support: "floor" | "seat";
  /** contact group that always rests on the support */
  primary: ContactGroup;
  /** second contact group kept on the floor when it touches it in the start pose */
  secondary?: ContactGroup;
  /** keep the second group on the floor even when the start pose lifts it */
  secondaryAlways?: boolean;
  /**
   * Share of spinal flexion taken up by tilting the pelvis the other way, so a
   * spine supported at both ends (hands and knees) arches in the middle.
   */
  pelvisFollowsSpine?: number;
  /** names of the two view buttons */
  views: [string, string];
  lying: boolean;
  /** free arms (not moved or pinned by the exercise) settle onto the floor */
  handsRest?: boolean;
};

const both = (segment: AngleEntry["segment"], motion: AngleEntry["motion"], degrees: number): AngleEntry => ({
  segment,
  motion,
  degrees,
  side: "both",
});

export const POSTURE_DEFS: Record<Posture, PostureDef> = {
  standing: {
    pitchDeg: 0,
    base: [both("elbow", "flexion", 8)],
    support: "floor",
    primary: "feet",
    views: ["Anterior", "Posterior"],
    lying: false,
  },
  seated: {
    pitchDeg: 0,
    base: [
      both("hip", "flexion", 90),
      both("knee", "flexion", 90),
      both("shoulder", "flexion", 22),
      both("elbow", "flexion", 62),
    ],
    support: "seat",
    primary: "seat",
    views: ["Anterior", "Posterior"],
    lying: false,
  },
  supine: {
    pitchDeg: -90,
    base: [both("elbow", "flexion", 6), both("ankle", "plantarflexion", 12)],
    support: "floor",
    primary: "back",
    secondary: "feet",
    views: ["Top", "Side"],
    lying: true,
    handsRest: true,
  },
  prone: {
    pitchDeg: 90,
    base: [both("elbow", "flexion", 6), both("ankle", "plantarflexion", 35)],
    support: "floor",
    primary: "front",
    views: ["Top", "Side"],
    lying: true,
  },
  quadruped: {
    pitchDeg: 90,
    base: [
      both("hip", "flexion", 90),
      both("knee", "flexion", 105),
      both("shoulder", "flexion", 90),
      both("ankle", "plantarflexion", 40),
      both("wrist", "extension", 50),
    ],
    support: "floor",
    primary: "knees",
    secondary: "hands",
    secondaryAlways: true,
    pelvisFollowsSpine: 0.5,
    views: ["Anterior", "Posterior"],
    lying: false,
  },
};
