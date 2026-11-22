/**
 * Deterministic clinical safety filter for exercise assignment.
 *
 * The module is a pure rulebook: it performs no I/O, reads no clock and embeds
 * no probabilistic reasoning. CONTRAINDICATION_RULES is the only clinical
 * knowledge here; extend it with clinical sign-off and never special-case the
 * filter logic.
 */

export type SpinalRegion = "cervical" | "thoracic" | "lumbar" | "sacral";

export type SpinalLevel =
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "C5"
  | "C6"
  | "C7"
  | "T1"
  | "T2"
  | "T3"
  | "T4"
  | "T5"
  | "T6"
  | "T7"
  | "T8"
  | "T9"
  | "T10"
  | "T11"
  | "T12"
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "S1"
  | "S2"
  | "S3"
  | "S4"
  | "S5";

export type PathologyType = "herniation" | "bulge" | "stenosis" | "sprain";

export type MovementPlane =
  | "flexion"
  | "extension"
  | "rotation"
  | "lateral"
  | "neutral";

export interface ClinicalDiagnosis {
  region: SpinalRegion;
  level: SpinalLevel;
  pathology: PathologyType;
}

export interface Exercise {
  id: string;
  name: string;
  required_movement_planes: MovementPlane[];
}

export interface ContraindicationRule {
  id: string;
  region: SpinalRegion | "any";
  pathology: PathologyType;
  planes: readonly MovementPlane[];
}

export const CONTRAINDICATION_RULES: readonly ContraindicationRule[] = [
  {
    id: "lumbar-herniation",
    region: "lumbar",
    pathology: "herniation",
    planes: ["flexion", "rotation"],
  },
  {
    id: "lumbar-bulge",
    region: "lumbar",
    pathology: "bulge",
    planes: ["flexion", "rotation"],
  },
  {
    id: "stenosis",
    region: "any",
    pathology: "stenosis",
    planes: ["extension"],
  },
];

const MOVEMENT_PLANE_ORDER: readonly MovementPlane[] = [
  "flexion",
  "extension",
  "rotation",
  "lateral",
  "neutral",
];

interface ResolvedContraindication {
  plane: MovementPlane;
  ruleId: string;
}

function resolveContraindications(
  diagnosis: ClinicalDiagnosis,
): ResolvedContraindication[] {
  return CONTRAINDICATION_RULES.filter(
    (rule) =>
      rule.pathology === diagnosis.pathology &&
      (rule.region === "any" || rule.region === diagnosis.region),
  ).flatMap((rule) =>
    rule.planes.map((plane) => ({ plane, ruleId: rule.id })),
  );
}

export function getContraindications(
  diagnosis: ClinicalDiagnosis,
): MovementPlane[] {
  const planes = new Set<MovementPlane>();
  for (const { plane } of resolveContraindications(diagnosis)) {
    planes.add(plane);
  }
  return MOVEMENT_PLANE_ORDER.filter((plane) => planes.has(plane));
}

export interface SafetyAuditEntry {
  exerciseId: string;
  exerciseName: string;
  contraindicatedPlane: MovementPlane;
  ruleId: string;
}

export interface SafetyFilterResult {
  approved: Exercise[];
  blocked: Exercise[];
  auditLog: SafetyAuditEntry[];
}

export function filterSafeExercises(
  diagnosis: ClinicalDiagnosis,
  proposedExercises: readonly Exercise[],
): SafetyFilterResult {
  const ruleByPlane = new Map<MovementPlane, string>();
  for (const { plane, ruleId } of resolveContraindications(diagnosis)) {
    if (!ruleByPlane.has(plane)) {
      ruleByPlane.set(plane, ruleId);
    }
  }

  const approved: Exercise[] = [];
  const blocked: Exercise[] = [];
  const auditLog: SafetyAuditEntry[] = [];

  for (const exercise of proposedExercises) {
    const triggers: ResolvedContraindication[] = [];
    for (const plane of exercise.required_movement_planes) {
      const ruleId = ruleByPlane.get(plane);
      if (ruleId !== undefined) {
        triggers.push({ plane, ruleId });
      }
    }

    if (triggers.length === 0) {
      approved.push(exercise);
      continue;
    }

    blocked.push(exercise);
    for (const { plane, ruleId } of triggers) {
      auditLog.push({
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        contraindicatedPlane: plane,
        ruleId,
      });
    }
  }

  return { approved, blocked, auditLog };
}
