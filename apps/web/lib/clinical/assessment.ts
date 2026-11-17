/**
 * Condition summary, source attribution and in-person-care escalation.
 * Pure functions shared by the server actions, the page loader and the UI.
 */
import type { ReportFiles } from "@/lib/intake/reportFiles";

export const CONDITION_SOURCES = [
  "reports_and_scans",
  "reports_and_symptoms",
  "scans_and_symptoms",
  "files_and_symptoms",
  "symptoms_only",
] as const;
export type ConditionSource = (typeof CONDITION_SOURCES)[number];

export const CONDITION_SOURCE_LABELS: Record<ConditionSource, string> = {
  reports_and_scans: "Derived from medical reports & scans",
  reports_and_symptoms: "Derived from medical reports & symptoms",
  scans_and_symptoms: "Derived from imaging scans & symptoms only",
  files_and_symptoms: "Derived from uploaded reports & symptoms",
  symptoms_only: "Derived from symptom description only",
};

/** Attribution comes from what was actually uploaded, never from the AI's claim. */
export function deriveConditionSource(files: ReportFiles): ConditionSource {
  if (files.prescriptions.length > 0) {
    return files.scans.length > 0 ? "reports_and_scans" : "reports_and_symptoms";
  }
  if (files.scans.length > 0) return "scans_and_symptoms";
  if (files.uncategorized.length > 0) return "files_and_symptoms";
  return "symptoms_only";
}

export function isConditionSource(value: unknown): value is ConditionSource {
  return typeof value === "string" && (CONDITION_SOURCES as readonly string[]).includes(value);
}

export type DetectedCondition = {
  title: string;
  summary: string;
  source: ConditionSource;
  requiresInPersonCare: boolean;
  careReason: string | null;
};

export type Escalation = {
  /** triage: found at intake. progress: daily sessions show the case is not improving. */
  kind: "triage" | "progress";
  reason: string;
  evidence: string[];
  escalatedAt: string;
};

// ---------------------------------------------------------------------------
// Deterministic red-flag backstop. The AI makes the main judgement; these are
// high-specificity warning signs that always need in-person care, so a missed
// AI judgement can never unlock exercises for them.

const RED_FLAGS: { label: string; pattern: RegExp }[] = [
  {
    label: "Loss of bladder or bowel control",
    pattern:
      /\b(loss of|losing|lost|can'?t control|cannot control|no control (of|over))\s+(my\s+)?(bladder|bowel)|\b(urinary|bowel|faecal|fecal)\s+incontinence\b|\bincontinen(t|ce)\b|\b(can'?t|cannot|unable to)\s+(pee|urinate)\b/i,
  },
  {
    label: "Numbness in the groin or saddle area",
    pattern: /\bsaddle\s+(numbness|anaesthesia|anesthesia)\b|\bnumb(ness)?\b[^.]{0,30}\b(groin|genitals?|buttocks? and inner thighs?|perineum)\b/i,
  },
  {
    label: "Progressive weakness or foot drop",
    pattern: /\bfoot\s+drop\b|\b(getting|growing|increasingly|progressive(ly)?)\s+weak(er|ness)?\b|\bweak(ness)?\b[^.]{0,25}\b(getting worse|worsening|spreading)\b/i,
  },
  {
    label: "Possible fracture",
    pattern: /\b(fracture[ds]?|broken\s+(bone|leg|arm|ankle|wrist|hip|rib|back|neck))\b|\b(can'?t|cannot|unable to)\s+(bear|put)\s+(any\s+)?weight\b/i,
  },
  {
    label: "Possible tendon or ligament rupture",
    pattern: /\b(rupture[ds]?|torn|complete tear)\b[^.]{0,25}\b(achilles|acl|tendon|ligament|rotator cuff|bicep|biceps|quadriceps)\b|\b(achilles|acl|tendon|ligament)\b[^.]{0,15}\b(rupture[ds]?|snapped|torn)\b/i,
  },
  {
    label: "Fever or unexplained weight loss with pain",
    pattern: /\b(fever|chills|night sweats|unexplained weight loss|losing weight without trying)\b/i,
  },
  {
    label: "Chest pain or trouble breathing",
    pattern: /\bchest\s+pain\b|\b(shortness of breath|can'?t breathe|trouble breathing|difficulty breathing)\b/i,
  },
  {
    label: "Pain after major trauma",
    pattern: /\b(car|road|motorbike|motorcycle|bike)\s+(accident|crash|collision)\b|\bfell from (a )?(height|ladder|roof|stairs)\b/i,
  },
];

const NEGATION = /\b(no|not|without|never|denies|deny|don'?t have|do not have|haven'?t had|none)\b[^.,;]{0,25}$/i;

/** Red flags mentioned in the text, ignoring negated mentions like "no fever". */
export function screenRedFlags(text: string): string[] {
  const found: string[] = [];
  for (const flag of RED_FLAGS) {
    const pattern = new RegExp(flag.pattern.source, `${flag.pattern.flags.replace("g", "")}g`);
    for (const match of text.matchAll(pattern)) {
      const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
      if (!NEGATION.test(before)) {
        found.push(flag.label);
        break;
      }
    }
  }
  return found;
}

const AFFIRMATIVE = /^\s*(yes|yeah|yep|y|sometimes|often|always|a little|slightly|mild(ly)?|it does|i do|i have)\b/i;

/** Red flags revealed by "yes"-style answers to triage questions. */
export function screenQuizAnswers(answers: { question: string; answer: string }[]): string[] {
  const flags = new Set<string>();
  for (const { question, answer } of answers) {
    // Free-text answers are screened on their own words.
    for (const flag of screenRedFlags(answer)) flags.add(flag);
    if (!AFFIRMATIVE.test(answer)) continue;
    for (const flag of screenRedFlags(question.replace(/\b(any|do you have|have you (had|noticed))\b/gi, ""))) {
      flags.add(flag);
    }
  }
  return [...flags];
}

// ---------------------------------------------------------------------------
// Ongoing-progress escalation.

export type SessionDay = {
  dateKey: string;
  feedback: "relief" | "same" | "issue" | null;
};

export type PainStop = { dateKey: string; painType: string };

export const ESCALATION_RULES = {
  /** Pain Override on this many separate days inside the window escalates. */
  painStopDays: 2,
  painStopWindowDays: 14,
  /** This many most recent sessions all negative escalates. */
  consecutiveNegative: 3,
  /** With at least this many sessions in the recent window, no relief and ≥2 negatives escalates. */
  plateauSessions: 5,
  plateauWindow: 7,
};

const DAY_MS = 86_400_000;

function dateKeyToTime(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Decide whether daily feedback shows the case is beyond guided online rehab.
 * A session is negative when the patient reported a problem or used Pain Override.
 */
export function evaluateProgressEscalation(
  days: SessionDay[],
  stops: PainStop[],
  todayKey: string,
): Omit<Escalation, "escalatedAt"> | null {
  const rules = ESCALATION_RULES;
  const today = dateKeyToTime(todayKey);
  const stopDays = new Set(stops.map((stop) => stop.dateKey));

  const sessions = new Map<string, { feedback: SessionDay["feedback"]; stopped: boolean }>();
  for (const day of days) {
    if (day.feedback) sessions.set(day.dateKey, { feedback: day.feedback, stopped: false });
  }
  for (const dateKey of stopDays) {
    sessions.set(dateKey, { feedback: sessions.get(dateKey)?.feedback ?? null, stopped: true });
  }
  const ordered = [...sessions.entries()]
    .map(([dateKey, value]) => ({ dateKey, ...value, negative: value.stopped || value.feedback === "issue" }))
    .sort((left, right) => dateKeyToTime(left.dateKey) - dateKeyToTime(right.dateKey));

  const evidence: string[] = [];

  const recentStopDays = [...stopDays].filter(
    (dateKey) => today - dateKeyToTime(dateKey) < rules.painStopWindowDays * DAY_MS,
  );
  const movementLoss = stops.filter((stop) => stop.painType === "movement_loss").length;
  if (recentStopDays.length >= rules.painStopDays) {
    evidence.push(
      `Pain Override was used on ${plural(recentStopDays.length, "separate day")} in the last ${rules.painStopWindowDays} days.`,
    );
    if (movementLoss > 0) {
      evidence.push(`${plural(movementLoss, "stop")} involved a sudden loss of movement.`);
    }
  }

  const lastSessions = ordered.slice(-rules.consecutiveNegative);
  if (lastSessions.length === rules.consecutiveNegative && lastSessions.every((session) => session.negative)) {
    evidence.push(`Your last ${rules.consecutiveNegative} sessions all ended with pain or worsening symptoms.`);
  }

  const window = ordered.slice(-rules.plateauWindow);
  const negatives = window.filter((session) => session.negative).length;
  if (
    window.length >= rules.plateauSessions &&
    !window.some((session) => session.feedback === "relief") &&
    negatives >= 2
  ) {
    evidence.push(
      `None of your last ${plural(window.length, "session")} brought relief, and ${negatives} caused problems.`,
    );
  }

  if (evidence.length === 0) return null;

  return {
    kind: "progress",
    reason:
      "Your sessions show your symptoms are not improving, or are getting worse, despite the guided plan. This is beyond what automated online physiotherapy can safely manage.",
    evidence,
  };
}
