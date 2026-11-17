/**
 * Baseline joint range table.
 *
 * STATUS: draft, not clinically reviewed. The values were drafted with AI help
 * from standard physiotherapy references and cross-checked against the
 * published sources listed per row. A clinician must review and sign off this
 * table before any public patient rollout (see CLINICAL_RANGES_REVIEWED).
 *
 * Values are "normal maximum" active range in degrees from anatomical zero.
 * Prescriptions are clamped to normalMaxDeg * prescribedMaxFraction, because
 * rehabilitation patients usually have less range than the normal reference.
 *
 * Sources (abbreviations used in the rows):
 * - AAOS: American Academy of Orthopaedic Surgeons, Joint Motion: Method of
 *   Measuring and Recording (1965), as summarised in clinical references such as
 *   https://www.enlyte.com/insights/article/specialty-physical-medicine/understanding-normal-range-motion-joint-functionality
 *   and https://www.physio-pedia.com/Lower_Extremity_Range_of_Motion
 * - NORKIN: Norkin CC, White DJ. Measurement of Joint Motion: A Guide to
 *   Goniometry, 5th ed. F.A. Davis (normative range of motion values appendix).
 * - NEUMANN: Neumann DA. Kinesiology of the Musculoskeletal System, 3rd ed.
 *   (regional spine, sternoclavicular and pelvic values).
 * - TROKE: Troke M et al. A new, comprehensive normative database of lumbar
 *   spine ranges of motion. Clin Rehabil 2001. https://pubmed.ncbi.nlm.nih.gov/11518438/
 * - LUDEWIG: Ludewig PM et al. Three-dimensional clavicular motion during arm
 *   elevation. J Orthop Sports Phys Ther 2004. https://pubmed.ncbi.nlm.nih.gov/15089027/
 * - INMAN: Inman VT et al. Observations on the function of the shoulder joint
 *   (1944), the 2:1 scapulohumeral rhythm.
 */
import {
  DIRECTIONAL_AXIAL_DOFS,
  SEGMENT_MOTIONS,
  isAxial,
  type Dof,
  type Motion,
  type Segment,
} from "./vocabulary";

/** Flip to true only after a clinician has signed off every row. */
export const CLINICAL_RANGES_REVIEWED = false;

export const DEFAULT_PRESCRIBED_FRACTION = 0.8;

export type JointRangeRow = {
  segment: Segment;
  motion: Motion;
  normalMaxDeg: number;
  prescribedMaxFraction: number;
  sources: string[];
  note?: string;
  status: "draft-unreviewed";
};

const row = (
  segment: Segment,
  motion: Motion,
  normalMaxDeg: number,
  sources: string[],
  note?: string,
  prescribedMaxFraction = DEFAULT_PRESCRIBED_FRACTION,
): JointRangeRow => ({
  segment,
  motion,
  normalMaxDeg,
  prescribedMaxFraction,
  sources,
  ...(note ? { note } : {}),
  status: "draft-unreviewed",
});

export const JOINT_TABLE: readonly JointRangeRow[] = [
  row("cervical", "flexion", 45, ["AAOS 45", "NORKIN 45 to 50"]),
  row("cervical", "extension", 45, ["AAOS 45", "NORKIN 45 to 75"], "Lower value chosen for safety."),
  row("cervical", "lateral_flexion", 45, ["AAOS 45", "NORKIN 45"]),
  row("cervical", "rotation", 60, ["AAOS 60", "NORKIN 60 to 80"], "Lower value chosen for safety."),
  row(
    "cervical",
    "retraction",
    20,
    ["NEUMANN atlanto-occipital flexion about 15 to 20"],
    "Chin tuck, modelled as upper cervical flexion with slight lower cervical extension.",
  ),
  row("thoracic", "flexion", 30, ["NEUMANN 30 to 40"]),
  row("thoracic", "extension", 20, ["NEUMANN 20 to 25"]),
  row("thoracic", "lateral_flexion", 25, ["NEUMANN 25 to 30"]),
  row("thoracic", "rotation", 30, ["NEUMANN 30 to 35"]),
  row("lumbar", "flexion", 50, ["NEUMANN 50", "TROKE 40 to 72 by age"]),
  row("lumbar", "extension", 20, ["NEUMANN 15", "TROKE 6 to 29 by age", "AAOS thoracolumbar 25"]),
  row("lumbar", "lateral_flexion", 20, ["NEUMANN 20", "TROKE 15 to 29 by age"]),
  row("lumbar", "rotation", 5, ["NEUMANN 5 to 7"]),
  row("pelvis", "anterior_tilt", 15, ["NEUMANN pelvic tilt about 10 to 15"]),
  row("pelvis", "posterior_tilt", 15, ["NEUMANN pelvic tilt about 10 to 15"]),
  row("scapula", "elevation", 45, ["NEUMANN sternoclavicular elevation 45", "LUDEWIG 11 to 15 during arm elevation"]),
  row("scapula", "depression", 10, ["NEUMANN sternoclavicular depression 10"]),
  row("scapula", "protraction", 15, ["NEUMANN sternoclavicular protraction 15 to 20"]),
  row("scapula", "retraction", 15, ["NEUMANN sternoclavicular retraction 15 to 30", "LUDEWIG 15 to 29"]),
  row(
    "shoulder",
    "flexion",
    180,
    ["AAOS 180", "NORKIN 180"],
    "Total arm elevation, shared with the scapula by the 2:1 rhythm (INMAN). Fraction 0.9 so overhead reaches remain visible.",
    0.9,
  ),
  row("shoulder", "extension", 60, ["AAOS 60", "NORKIN 60"]),
  row("shoulder", "abduction", 180, ["AAOS 180", "NORKIN 180"], "Total arm elevation, shared with the scapula by the 2:1 rhythm (INMAN)."),
  row("shoulder", "adduction", 10, ["AAOS 0 from anatomical position"], "Small value so the arm does not pass through the trunk."),
  row("shoulder", "horizontal_adduction", 135, ["AAOS horizontal flexion 135"]),
  row("shoulder", "horizontal_abduction", 45, ["AAOS horizontal extension 45"]),
  row("shoulder", "internal_rotation", 70, ["AAOS 70", "NORKIN 70"]),
  row("shoulder", "external_rotation", 90, ["AAOS 90", "NORKIN 90"]),
  row("elbow", "flexion", 150, ["AAOS 150", "NORKIN 140 to 150"]),
  row("elbow", "extension", 0, ["AAOS 0"], "Extension returns to straight. Hyperextension is not prescribed."),
  row("forearm", "pronation", 80, ["AAOS 80", "NORKIN 80"]),
  row("forearm", "supination", 80, ["AAOS 80", "NORKIN 80"]),
  row("wrist", "flexion", 80, ["AAOS 80", "NORKIN 80"]),
  row("wrist", "extension", 70, ["AAOS 70", "NORKIN 70"]),
  row("wrist", "radial_deviation", 20, ["AAOS 20", "NORKIN 20"]),
  row("wrist", "ulnar_deviation", 30, ["AAOS 30", "NORKIN 30"]),
  row(
    "hip",
    "flexion",
    120,
    ["AAOS 120", "NORKIN 120"],
    "Fraction 0.9: sitting already uses 90 degrees, so 0.8 would leave a seated knee lift only 6 degrees.",
    0.9,
  ),
  row("hip", "extension", 30, ["AAOS 30", "NORKIN 20 to 30"]),
  row("hip", "abduction", 45, ["AAOS 45", "NORKIN 40 to 45"]),
  row("hip", "adduction", 30, ["AAOS 30", "NORKIN 30"]),
  row("hip", "internal_rotation", 45, ["AAOS 45", "NORKIN 40 to 45"]),
  row("hip", "external_rotation", 45, ["AAOS 45", "NORKIN 45 to 50"]),
  row("knee", "flexion", 135, ["AAOS 135", "NORKIN 135 to 140"]),
  row("knee", "extension", 0, ["AAOS 0"], "Extension returns to straight. Hyperextension is not prescribed."),
  row("ankle", "dorsiflexion", 20, ["AAOS 20", "NORKIN 20"]),
  row("ankle", "plantarflexion", 50, ["AAOS 50", "NORKIN 50"]),
  row("ankle", "inversion", 35, ["AAOS 35", "NORKIN 35"]),
  row("ankle", "eversion", 15, ["AAOS 15", "NORKIN 15 to 20"]),
];

const byKey = new Map(JOINT_TABLE.map((entry) => [`${entry.segment}:${entry.motion}`, entry]));

export function rangeRow(segment: Segment, motion: Motion): JointRangeRow | undefined {
  return byKey.get(`${segment}:${motion}`);
}

/** Largest angle that may be prescribed for this segment and motion. */
export function prescribedMax(segment: Segment, motion: Motion): number {
  const entry = rangeRow(segment, motion);
  return entry ? entry.normalMaxDeg * entry.prescribedMaxFraction : 0;
}

export type DofLimit = { min: number; max: number };

/** Signed limits for a segment's degree of freedom, positive direction first. */
export function dofLimit(segment: Segment, dof: Dof): DofLimit {
  let positive = 0;
  let negative = 0;
  for (const [motion, mapping] of Object.entries(SEGMENT_MOTIONS[segment])) {
    if (!mapping || mapping.dof !== dof) continue;
    const limit = prescribedMax(segment, motion as Motion);
    if (mapping.sign === 1) positive = Math.max(positive, limit);
    else negative = Math.max(negative, limit);
  }

  // Lateral flexion and rotation of the spine use one motion name for both
  // directions, so the same limit applies to the left and to the right.
  if (isAxial(segment) && DIRECTIONAL_AXIAL_DOFS.has(dof)) negative = positive;
  return { min: negative > 0 ? -negative : 0, max: positive };
}

export function clampToDof(segment: Segment, dof: Dof, degrees: number) {
  const { min, max } = dofLimit(segment, dof);
  return Math.min(max, Math.max(min, degrees));
}
