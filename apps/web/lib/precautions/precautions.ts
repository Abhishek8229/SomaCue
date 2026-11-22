/*
 * Precautions: short safety bullets shown beside the plan.
 *
 * Permanent precautions are about the condition and come from the analysis, once.
 * Dynamic precautions follow the plan: the current week and phase, the latest session feedback,
 * Pain Override reports and missed days. They are rebuilt by the rules below, with no AI call, from
 * data the app already saved, so every change is instant, free and testable.
 *
 * Pure and free of server imports, so the browser and the server read the same rules.
 */

export const PRECAUTION_MIN = 3;
export const PRECAUTION_MAX = 5;
const BULLET_MAX_CHARS = 200;

/** Used to fill a list the AI left short. Safe for every condition. */
export const SAFE_DEFAULTS: readonly string[] = [
  "Stop an exercise at once if you feel sharp, shooting or worsening pain, and rest.",
  "Move slowly and stay inside a comfortable range. Never force a stretch or push through pain.",
  "Warm up with gentle movement first, and stop the session if you feel dizzy or unwell.",
  "Get urgent medical help for numbness in the groin, new weakness, or loss of bladder or bowel control.",
];

/** The permanent list for a plan saved before precautions existed: the safe defaults, which suit every condition. */
export function legacyPermanentPrecautions(): string[] {
  return normalizePrecautions([...SAFE_DEFAULTS], []);
}

/** What caused the latest change to the dynamic precautions. */
export type PrecautionUpdate = "initial" | "feedback" | "pain_override" | "week" | "missed_day";

export type DynamicPrecautions = {
  items: string[];
  /** the badge shown beside the list, for example "Week 1 • Active" or "Updated after feedback" */
  badge: string;
  kind: PrecautionUpdate;
  /** ISO time of the latest change */
  updatedAt: string;
  /** ISO time the user last opened the Dynamic tab; null or older than updatedAt means unread */
  seenAt: string | null;
  weekNumber: number;
  phaseIndex: number;
  /** the AI's own week-1 bullets, kept to fill the list when the rules give fewer than 3 */
  base: string[];
};

export type PlanPrecautions = { permanent: string[]; dynamic: DynamicPrecautions };

const UPDATE_KINDS: readonly string[] = ["initial", "feedback", "pain_override", "week", "missed_day"];

function clean(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim().replace(/^[-•*]\s*/, "");
  return trimmed.length > BULLET_MAX_CHARS ? `${trimmed.slice(0, BULLET_MAX_CHARS - 1).trimEnd()}…` : trimmed;
}

/** Trims, de-duplicates and caps a list of bullets at 5. A list shorter than 3 is filled from `fallback`. */
export function normalizePrecautions(value: unknown, fallback: readonly string[] = SAFE_DEFAULTS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (text: unknown) => {
    if (typeof text !== "string" || out.length >= PRECAUTION_MAX) return;
    const bullet = clean(text);
    const key = bullet.toLowerCase();
    if (bullet && !seen.has(key)) {
      seen.add(key);
      out.push(bullet);
    }
  };
  if (Array.isArray(value)) value.forEach(add);
  for (const text of fallback) {
    if (out.length >= PRECAUTION_MIN) break;
    add(text);
  }
  return out;
}

/** The stored permanent precautions, or null when the plan has none (it predates them). */
export function parsePermanentPrecautions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length > 0 ? items.slice(0, PRECAUTION_MAX) : null;
}

/** The stored dynamic precautions, checked, or null when missing or malformed. */
export function parseDynamicPrecautions(value: unknown): DynamicPrecautions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const items = parsePermanentPrecautions(raw.items);
  if (
    !items ||
    typeof raw.badge !== "string" ||
    typeof raw.kind !== "string" ||
    !UPDATE_KINDS.includes(raw.kind) ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.weekNumber !== "number" ||
    typeof raw.phaseIndex !== "number"
  ) {
    return null;
  }
  return {
    items,
    badge: raw.badge,
    kind: raw.kind as PrecautionUpdate,
    updatedAt: raw.updatedAt,
    seenAt: typeof raw.seenAt === "string" ? raw.seenAt : null,
    weekNumber: raw.weekNumber,
    phaseIndex: raw.phaseIndex,
    base: Array.isArray(raw.base) ? raw.base.filter((item): item is string => typeof item === "string") : [],
  };
}

/** Week of the plan for a plan day (Day 1 to 7 is week 1). */
export function weekOfPlan(dayNumber: number): number {
  return Math.max(1, Math.ceil(dayNumber / 7));
}

/** The plan phase (one per 30-day month) a plan day falls in, never past the last phase. */
export function phaseIndexOf(dayNumber: number, phaseCount: number): number {
  return Math.max(0, Math.min(Math.max(1, phaseCount) - 1, Math.floor((Math.max(1, dayNumber) - 1) / 30)));
}

/** True when the stored week or phase no longer matches the plan day, so the precautions need a "new week" rebuild. */
export function precautionsAreStale(current: Pick<DynamicPrecautions, "weekNumber" | "phaseIndex">, dayNumber: number, phaseCount: number): boolean {
  return current.weekNumber !== weekOfPlan(dayNumber) || current.phaseIndex !== phaseIndexOf(dayNumber, phaseCount);
}

export function badgeFor(kind: PrecautionUpdate, weekNumber: number): string {
  switch (kind) {
    case "feedback":
      return "Updated after feedback";
    case "pain_override":
      return "Updated after Pain Override";
    case "missed_day":
      return "Updated after a missed day";
    default:
      return `Week ${weekNumber} • Active`;
  }
}

/** Changed since the user last opened the Dynamic tab. A brand new plan counts as seen. */
export function isUnread(dynamic: Pick<DynamicPrecautions, "updatedAt" | "seenAt">): boolean {
  if (!dynamic.seenAt) return true;
  return new Date(dynamic.seenAt).getTime() < new Date(dynamic.updatedAt).getTime();
}

export type PrecautionFeedback = {
  dateKey: string;
  feedback: "relief" | "same" | "issue";
  discomfortExercises: string[];
};

export type PrecautionPainEvent = {
  dateKey: string;
  exerciseNames: string[];
  regions: string[];
  painType: string;
};

export type DynamicInput = {
  kind: PrecautionUpdate;
  weekNumber: number;
  phase: { phase: string; tagline: string } | null;
  /** the AI's week-1 bullets */
  base: readonly string[];
  /** feedback from the last 7 days, newest first */
  feedback: readonly PrecautionFeedback[];
  /** Pain Override reports from the last 7 days, newest first */
  painEvents: readonly PrecautionPainEvent[];
  /** working days missed in the last 7 days */
  missedDays: number;
};

const words = (text: string) => text.replace(/_/g, " ");

function listOf(names: readonly string[], fallback: string): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return fallback;
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/**
 * The 3 to 5 bullets for the plan as it stands. The newest and most safety-relevant first: a Pain
 * Override, then the latest feedback, then missed days, then the week and phase. The AI's own
 * week-1 bullets fill what is left, and safe defaults keep the list at 3 or more.
 */
export function buildDynamicItems(input: DynamicInput): string[] {
  const items: string[] = [];

  const pain = input.painEvents[0];
  if (pain) {
    const area = listOf(pain.regions.map(words), "the painful area");
    items.push(
      `Pain Override on ${pain.dateKey}: avoid ${listOf(pain.exerciseNames, "the movement that hurt")} until it has settled, and keep clear of the ${area}.`,
      `If the pain in the ${area} comes back, stop straight away and rest. Do not push through it.`,
    );
  }

  const latest = input.feedback[0];
  if (latest?.feedback === "issue") {
    items.push(
      `More discomfort with ${listOf(latest.discomfortExercises, "your last session")}: use a smaller range, go slower, and stop if it returns.`,
    );
  } else if (latest?.feedback === "same") {
    items.push("Little change so far: keep today's range and add no extra reps or speed.");
  } else if (latest?.feedback === "relief") {
    items.push("You are feeling better: add reps or range in small steps, and only if the last session felt comfortable.");
  }

  if (input.missedDays > 0) {
    items.push(
      `You missed ${input.missedDays} day${input.missedDays === 1 ? "" : "s"}: restart at the planned pace, not harder, to catch up.`,
    );
  }

  items.push(
    input.phase
      ? `${input.phase.phase} (week ${input.weekNumber}): ${input.phase.tagline}. Move on only when the last session felt comfortable.`
      : `Week ${input.weekNumber}: move on only when the last session felt comfortable.`,
  );

  return normalizePrecautions([...items, ...input.base], SAFE_DEFAULTS);
}

/** The full dynamic record for a change of this kind, unread unless it is the first one for the plan. */
export function createDynamicPrecautions(input: DynamicInput & { phaseIndex: number; now?: Date }): DynamicPrecautions {
  const now = (input.now ?? new Date()).toISOString();
  return {
    items: buildDynamicItems(input),
    badge: badgeFor(input.kind, input.weekNumber),
    kind: input.kind,
    updatedAt: now,
    // The first set comes with the plan, so there is nothing new to point out.
    seenAt: input.kind === "initial" ? now : null,
    weekNumber: input.weekNumber,
    phaseIndex: input.phaseIndex,
    base: normalizePrecautions(input.base, []),
  };
}

/**
 * The precautions a new plan starts with: the AI's own permanent list and week-1 list. The week-1 list
 * is the AI's, tailored to this condition, so it is stored as it came, not rebuilt by the rules.
 */
export function initialPrecautions(
  ai: { permanentPrecautions?: unknown; dynamicPrecautions?: unknown },
  now: Date = new Date(),
): PlanPrecautions {
  const permanent = normalizePrecautions(ai.permanentPrecautions);
  const base = normalizePrecautions(ai.dynamicPrecautions);
  const stamp = now.toISOString();
  return {
    permanent,
    dynamic: {
      items: base,
      badge: badgeFor("initial", 1),
      kind: "initial",
      updatedAt: stamp,
      seenAt: stamp,
      weekNumber: 1,
      phaseIndex: 0,
      base,
    },
  };
}
