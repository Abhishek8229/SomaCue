import { z } from "zod";
import { clampToDof, prescribedMax } from "./joint-table";
import {
  DIRECTIONAL_AXIAL_DOFS,
  MOTIONS,
  PINS,
  POSTURES,
  REGIONS,
  SEGMENTS,
  SIDES,
  isAxial,
  motionMapping,
  type Dof,
  type Motion,
  type Pin,
  type Posture,
  type Region,
  type Segment,
  type Side,
} from "./vocabulary";

/**
 * A movement spec describes one exercise in textbook terms. The AI returns one
 * per exercise and the kinematics engine turns it into live motion. It never
 * contains bone names or coordinates.
 */

export const angleEntrySchema = z.object({
  segment: z.enum(SEGMENTS).describe("Body segment or joint"),
  motion: z.enum(MOTIONS).describe("Anatomical motion of that segment"),
  side: z
    .enum(SIDES)
    .optional()
    .describe("Limbs: which limb. Spine lateral flexion or rotation: the direction"),
  degrees: z.number().min(0).max(180).describe("Angle from anatomical zero in degrees"),
});
export type AngleEntry = z.infer<typeof angleEntrySchema>;

export const tempoSchema = z.object({
  upSeconds: z.number().min(0.5).max(10),
  holdSeconds: z.number().min(0).max(30),
  downSeconds: z.number().min(0.5).max(10),
  restSeconds: z.number().min(0).max(30),
});

export const movementSpecSchema = z.object({
  posture: z.enum(POSTURES),
  startPose: z
    .array(angleEntrySchema)
    .max(12)
    .describe("Positions held for the whole exercise, for example hook lying knees"),
  movements: z
    .array(angleEntrySchema)
    .min(1)
    .max(8)
    .describe("End position of each rep. Each rep moves from the start pose to here and back"),
  alternateSides: z.boolean().describe("Mirror left and right on every other rep"),
  pins: z.array(z.enum(PINS)).max(4).describe("Hands or feet that stay planted"),
  tempo: tempoSchema,
  reps: z.number().int().min(1).max(30),
  sets: z.number().int().min(1).max(5),
  targetRegions: z.array(z.enum(REGIONS)).min(1).max(6),
  cues: z.array(z.string().min(1).max(160)).max(4),
  stopIf: z.array(z.string().min(1).max(160)).max(3),
});
export type MovementSpec = z.infer<typeof movementSpecSchema>;

/** Movement as stored in older or partially valid plans. Parsed leniently on read. */
export function parseMovementSpec(value: unknown): MovementSpec | null {
  const parsed = movementSpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type SpecWarning = { entry: AngleEntry; reason: string };

/**
 * Removes motions that a segment cannot do and clamps every angle to the
 * joint table. Used on the server before saving and on the client before
 * animating, so both always agree.
 */
export function normalizeSpec(spec: MovementSpec): { spec: MovementSpec; warnings: SpecWarning[] } {
  const warnings: SpecWarning[] = [];
  const clean = (entries: AngleEntry[]) =>
    entries.flatMap((entry) => {
      if (!motionMapping(entry.segment, entry.motion)) {
        warnings.push({ entry, reason: `${entry.segment} cannot do ${entry.motion}` });
        return [];
      }
      const max = prescribedMax(entry.segment, entry.motion);
      if (entry.degrees > max + 1e-6) {
        warnings.push({ entry, reason: `clamped from ${entry.degrees} to ${Math.round(max)} degrees` });
        return [{ ...entry, degrees: max }];
      }
      return [entry];
    });

  const movements = clean(spec.movements);
  return {
    spec: { ...spec, startPose: clean(spec.startPose), movements: movements.length ? movements : [] },
    warnings,
  };
}

/** Pose in solver terms: key "segment.side.dof" where side is L, R or C. */
export type DofPose = Record<string, number>;

export function dofKey(segment: Segment, sideKey: "L" | "R" | "C", dof: Dof) {
  return `${segment}.${sideKey}.${dof}`;
}

export function entriesToDofs(entries: AngleEntry[], mirror = false): DofPose {
  const pose: DofPose = {};
  for (const entry of entries) {
    const mapping = motionMapping(entry.segment, entry.motion);
    if (!mapping) continue;
    const side = mirror ? mirrorSide(entry.side) : entry.side;
    if (isAxial(entry.segment)) {
      let value = mapping.sign * entry.degrees;
      if (DIRECTIONAL_AXIAL_DOFS.has(mapping.dof) && side === "right") value = -value;
      pose[dofKey(entry.segment, "C", mapping.dof)] = value;
      continue;
    }
    const sideKeys = side === "left" ? ["L"] : side === "right" ? ["R"] : ["L", "R"];
    for (const key of sideKeys) {
      pose[dofKey(entry.segment, key as "L" | "R", mapping.dof)] = mapping.sign * entry.degrees;
    }
  }
  return pose;
}

function mirrorSide(side: Side | undefined): Side | undefined {
  return side === "left" ? "right" : side === "right" ? "left" : side;
}

export function mirrorPins(pins: readonly Pin[], mirror: boolean): Pin[] {
  if (!mirror) return [...pins];
  return pins.map((pin) =>
    pin.startsWith("left_") ? (pin.replace("left_", "right_") as Pin) : (pin.replace("right_", "left_") as Pin),
  );
}

export function mirrorRegions(regions: readonly Region[], mirror: boolean): Region[] {
  if (!mirror) return [...regions];
  return regions.map((region) =>
    region.endsWith("_left")
      ? (region.replace(/_left$/, "_right") as Region)
      : region.endsWith("_right")
        ? (region.replace(/_right$/, "_left") as Region)
        : region,
  );
}

/** Clamp every degree of freedom of a pose to the joint table. */
export function clampPose(pose: DofPose): DofPose {
  const out: DofPose = {};
  for (const [key, value] of Object.entries(pose)) {
    const [segment, , dof] = key.split(".") as [Segment, string, Dof];
    out[key] = clampToDof(segment, dof, value);
  }
  return out;
}

export function mergePoses(...poses: DofPose[]): DofPose {
  return Object.assign({}, ...poses);
}

export function lerpPose(from: DofPose, to: DofPose, t: number): DofPose {
  const out: DofPose = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    const a = from[key] ?? 0;
    const b = to[key] ?? 0;
    out[key] = a + (b - a) * t;
  }
  return out;
}

export function describeEntry(entry: AngleEntry) {
  const side = entry.side && entry.side !== "both" ? `${entry.side} ` : "";
  return `${side}${entry.segment} ${entry.motion.replaceAll("_", " ")} ${Math.round(entry.degrees)}°`;
}

export function specPosture(spec: MovementSpec): Posture {
  return spec.posture;
}

export function specMotions(spec: MovementSpec): Array<{ segment: Segment; motion: Motion }> {
  return spec.movements.map(({ segment, motion }) => ({ segment, motion }));
}
