import { Vector3 } from "three";
import { normalizeSpec, type MovementSpec } from "./movement-spec";
import { groupLowest, sampleVertices, type BodyRig } from "./rig";
import {
  deepestOverlap,
  poseAt,
  prepareMovement,
  safeProgress,
  solvePose,
  OVERLAP_TOLERANCE_M,
} from "./solver";

/** Pass thresholds, fixed before measuring (docs/3d-engine/plan.md, section 6.8). */
export const MOTION_THRESHOLDS = {
  floorClearanceMm: -2,
  pinSlipMm: 5,
  overlapMm: OVERLAP_TOLERANCE_M * 1000,
  minSafeProgress: 0.6,
} as const;

export type MotionMetrics = {
  minClearanceMm: number;
  maxPinSlipMm: number;
  maxOverlapMm: number;
  safeProgress: number;
  finite: boolean;
  clampedEntries: number;
};

export type MotionReport = {
  ok: boolean;
  issues: string[];
  metrics: MotionMetrics;
};

/**
 * Runs the real solver across the whole movement (both sides if it
 * alternates) and measures floor contact, pin slip and body overlap.
 * Movement is sampled only up to the safe progress the engine will use.
 */
export function validateMovement(rig: BodyRig, input: MovementSpec, samples = 10): MotionReport {
  const { spec, warnings } = normalizeSpec(input);
  const issues: string[] = [];
  if (spec.movements.length === 0) {
    return {
      ok: false,
      issues: ["No valid movement remains after checking the vocabulary."],
      metrics: { minClearanceMm: 0, maxPinSlipMm: 0, maxOverlapMm: 0, safeProgress: 0, finite: true, clampedEntries: warnings.length },
    };
  }

  let minClearance = Infinity;
  let maxSlip = 0;
  let maxOverlap = 0;
  let finite = true;
  let safest = 1;
  const sides = spec.alternateSides ? [false, true] : [false];
  for (const mirrored of sides) {
    const safe = safeProgress(rig, spec, mirrored);
    safest = Math.min(safest, safe);
    const setup = prepareMovement(rig, spec, mirrored);
    for (let k = 0; k <= samples; k++) {
      const progress = (k / samples) * safe;
      const { slip } = solvePose(rig, spec.posture, poseAt(spec, progress, mirrored), setup);
      sampleVertices(rig.mesh, rig.sampler);
      const low = groupLowest(rig.sampler, "all") as Vector3;
      if (!Number.isFinite(low.y)) finite = false;
      minClearance = Math.min(minClearance, low.y * 1000);
      for (const value of Object.values(slip)) maxSlip = Math.max(maxSlip, (value ?? 0) * 1000);
      maxOverlap = Math.max(maxOverlap, (deepestOverlap(rig)?.depth ?? 0) * 1000);
      for (const bone of rig.mesh.skeleton.bones) {
        const q = bone.quaternion;
        if (![q.x, q.y, q.z, q.w].every(Number.isFinite)) finite = false;
      }
    }
  }

  if (!finite) issues.push("Non-finite values in the solved pose.");
  if (minClearance < MOTION_THRESHOLDS.floorClearanceMm) {
    issues.push(`Body goes ${Math.abs(minClearance).toFixed(1)} mm below the support.`);
  }
  if (maxSlip > MOTION_THRESHOLDS.pinSlipMm) issues.push(`A planted hand or foot slips ${maxSlip.toFixed(1)} mm.`);
  if (safest < MOTION_THRESHOLDS.minSafeProgress) {
    issues.push(`Only ${Math.round(safest * 100)}% of the movement is clear of body overlap.`);
  }

  return {
    ok: issues.length === 0,
    issues,
    metrics: {
      minClearanceMm: minClearance,
      maxPinSlipMm: maxSlip,
      maxOverlapMm: maxOverlap,
      safeProgress: safest,
      finite,
      clampedEntries: warnings.length,
    },
  };
}
