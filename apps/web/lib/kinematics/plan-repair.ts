import type { ScheduleWithSteps, StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import { mirrorRegions, normalizeSpec, parseMovementSpec, type MovementSpec } from "./movement-spec";
import { findReferenceExercise } from "./reference-exercises";
import type { BodyRig } from "./rig";
import { validateMovement } from "./validate";
import { regionsForSegment, type Region } from "./vocabulary";

/**
 * Server-side deterministic repair of AI movement specs, run before a plan is
 * saved. Each spec is checked against the vocabulary, clamped to the joint
 * table and solved on the real body. A spec that still fails is replaced by
 * the matching reference exercise, or dropped so the stage shows text only.
 * No second AI call is made (it would add 30 to 50 seconds).
 */

type StepLike = { exerciseName: string; movement?: unknown; [key: string]: unknown };

let rigPromise: Promise<BodyRig | null> | null = null;

async function headlessRig(): Promise<BodyRig | null> {
  if (!rigPromise) {
    rigPromise = import("./node-body")
      .then(({ loadBodyRigNode }) => loadBodyRigNode())
      .catch((error: unknown) => {
        console.error("[SomaCue motion] Headless body unavailable, skipping solver checks.", {
          message: error instanceof Error ? error.message : String(error),
        });
        rigPromise = null;
        return null;
      });
  }
  return rigPromise;
}

export type RepairLog = { exerciseName: string; action: "kept" | "clamped" | "reference" | "dropped"; detail?: string };

function checked(rig: BodyRig | null, spec: MovementSpec) {
  if (!rig) return { ok: true, issues: [] as string[] };
  try {
    return validateMovement(rig, spec, 6);
  } catch (error) {
    return { ok: false, issues: [error instanceof Error ? error.message : String(error)] };
  }
}

export function repairStepWith<T extends StepLike>(
  rig: BodyRig | null,
  step: T,
  known: Map<string, MovementSpec>,
  log: RepairLog[],
): T {
  const { movement: _ignored, ...rest } = step;
  void _ignored;
  const candidate = parseMovementSpec(step.movement) ?? known.get(step.exerciseName) ?? null;

  if (candidate) {
    const { spec, warnings } = normalizeSpec(candidate);
    if (spec.movements.length > 0) {
      const report = checked(rig, spec);
      if (report.ok) {
        log.push({ exerciseName: step.exerciseName, action: warnings.length ? "clamped" : "kept" });
        return { ...rest, movement: spec } as T;
      }
      log.push({ exerciseName: step.exerciseName, action: "dropped", detail: report.issues.join(" ") });
    }
  }

  const reference = findReferenceExercise(step.exerciseName);
  if (reference) {
    log.push({ exerciseName: step.exerciseName, action: "reference", detail: reference.id });
    return { ...rest, movement: normalizeSpec(reference.spec).spec } as T;
  }
  log.push({ exerciseName: step.exerciseName, action: "dropped", detail: "no valid movement" });
  return rest as T;
}

function knownMovements(plan: Pick<StoredTreatmentPlan, "steps" | "schedule">) {
  const known = new Map<string, MovementSpec>();
  const add = (step: StepLike) => {
    const spec = parseMovementSpec(step.movement);
    if (spec && !known.has(step.exerciseName)) known.set(step.exerciseName, spec);
  };
  plan.steps.forEach(add);
  plan.schedule?.days.forEach((day) => day.steps?.forEach(add));
  return known;
}

/** Repair every step of a freshly generated plan. */
export async function repairPlan<T extends StoredTreatmentPlan>(plan: T): Promise<T> {
  const rig = await headlessRig();
  const log: RepairLog[] = [];
  const known = knownMovements(plan);
  const steps = plan.steps.map((step) => repairStepWith(rig, step, known, log));
  const schedule = plan.schedule
    ? {
        ...plan.schedule,
        days: plan.schedule.days.map((day) =>
          day.steps ? { ...day, steps: day.steps.map((step) => repairStepWith(rig, step, known, log)) } : day,
        ),
      }
    : plan.schedule;
  logRepairs(log);
  return { ...plan, steps, schedule };
}

/** Repair rescheduled days. Unchanged exercises reuse the plan's existing movement by name. */
export async function repairSchedule(schedule: ScheduleWithSteps, plan: StoredTreatmentPlan): Promise<ScheduleWithSteps> {
  const rig = await headlessRig();
  const log: RepairLog[] = [];
  const known = knownMovements(plan);
  const days = schedule.days.map((day) =>
    day.steps ? { ...day, steps: day.steps.map((step) => repairStepWith(rig, step, known, log)) } : day,
  );
  logRepairs(log);
  return { ...schedule, days };
}

function logRepairs(log: RepairLog[]) {
  const changed = log.filter((entry) => entry.action !== "kept");
  if (changed.length) console.info("[SomaCue motion] Movement repairs.", changed);
}

/**
 * Every region a movement loads. An alternating exercise mirrors left and right on every other rep
 * (see `timeline.ts`), so a region tagged `knee_left` is also loaded as `knee_right`. Both sides count.
 */
export function loadedRegions(spec: MovementSpec): Region[] {
  const regions = [
    ...spec.targetRegions,
    ...spec.movements.flatMap((entry) => regionsForSegment(entry.segment, entry.side)),
  ];
  return spec.alternateSides ? [...new Set([...regions, ...mirrorRegions(regions, true)])] : regions;
}

function stepRegions(step: StepLike): Region[] {
  const spec = parseMovementSpec(step.movement);
  return spec ? loadedRegions(spec) : [];
}

/**
 * Red-flag veto. On every day after today, remove exercises that were
 * reported or that load a reported region. A day left empty becomes a rest day.
 */
export function stripFlaggedMovements(
  schedule: ScheduleWithSteps,
  flagged: { exerciseNames: string[]; regions: Region[] },
): ScheduleWithSteps {
  const names = new Set(flagged.exerciseNames.map((name) => name.trim().toLowerCase()));
  const regions = new Set(flagged.regions);
  const days = schedule.days.map((day) => {
    if (day.dayOffset < 1 || !day.steps) return day;
    const steps = day.steps.filter(
      (step) => !names.has(step.exerciseName.trim().toLowerCase()) && !stepRegions(step).some((r) => regions.has(r)),
    );
    if (steps.length > 0 || day.status === "rest") return { ...day, steps };
    const { steps: _removed, ...rest } = day;
    void _removed;
    return {
      ...rest,
      status: "rest" as const,
      focus: "Recovery",
      tagline: "Rest after your stop report. Ask a clinician before progressing.",
    };
  });
  return { ...schedule, days };
}
