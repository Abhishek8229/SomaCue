import { planDayNumber } from "@/lib/billing/plans";
import { phaseIndexOf, weekOfPlan, type DynamicPrecautions } from "@/lib/precautions/precautions";
import { PAIN_TYPE_LABELS } from "@/lib/progress/painEvent";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";

/*
 * The Recovery Timeline (Patient Case Record): one chronological list of what happened in a patient's
 * recovery, from the first analysis on. Pure and free of server imports, so the dashboard, the export
 * and the tests all read the same rules.
 *
 * Events come from two places and are merged by `key`:
 *  - the log (RecoveryEvent rows), written as things happen, and
 *  - the history the app already stored (reports, plans, daily logs, pain events), derived at read time,
 *    so an account that predates the log has a full timeline at once.
 * The same fact always gets the same key, so it never shows twice. The logged copy wins because it keeps
 * what a later reset or re-run overwrites.
 */

export type RecoveryKind =
  | "analysis"
  | "plan"
  | "week"
  | "missed_day"
  | "session"
  | "feedback"
  | "pain_override"
  | "plan_adjusted"
  | "precaution"
  | "chat_insight"
  | "escalation";

export type RecoveryTone = "info" | "good" | "warn" | "alert";

export type FeedbackValue = "relief" | "same" | "issue";

/** Small structured facts kept with an event, for the trends. */
export type RecoveryMeta = {
  feedback?: FeedbackValue;
  regions?: string[];
  painType?: string;
};

export type RecoveryEvent = {
  /** Stable per fact. Logging or deriving the same fact twice gives the same key. */
  key: string;
  kind: RecoveryKind;
  title: string;
  detail: string | null;
  /** ISO time the event happened. */
  occurredAt: string;
  /** The local YYYY-MM-DD the event is about, for events about a day. */
  dateKey: string | null;
  reportId: string | null;
  meta: RecoveryMeta | null;
};

export const KIND_LABELS: Record<RecoveryKind, string> = {
  analysis: "Analysis",
  plan: "Plan",
  week: "Progress",
  missed_day: "Missed day",
  session: "Session",
  feedback: "Feedback",
  pain_override: "Pain Override",
  plan_adjusted: "Plan adjusted",
  precaution: "Precautions",
  chat_insight: "Companion chat",
  escalation: "In-person care",
};

export const FEEDBACK_TITLES: Record<FeedbackValue, string> = {
  relief: "Feeling better after the session",
  same: "No change after the session",
  issue: "More discomfort after the session",
};

export function toneOf(event: Pick<RecoveryEvent, "kind" | "meta">): RecoveryTone {
  switch (event.kind) {
    case "pain_override":
    case "escalation":
      return "alert";
    case "missed_day":
    case "plan_adjusted":
    case "precaution":
      return "warn";
    case "session":
      return "good";
    case "feedback":
      return event.meta?.feedback === "relief" ? "good" : event.meta?.feedback === "issue" ? "warn" : "info";
    case "chat_insight":
      return event.meta?.feedback === "relief" ? "good" : event.meta?.feedback === "issue" ? "warn" : "info";
    default:
      return "info";
  }
}

const DAY_MS = 86_400_000;
const DETAIL_MAX = 320;

function clip(text: string, max = DETAIL_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const words = (text: string) => text.replace(/_/g, " ");

function list(names: readonly string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * A stable time for an event that is about a day, not a moment. Things that begin a day (a new week) sit at
 * its start; things found at its end (a missed day) sit at its end, so they follow what happened that day.
 */
export function dayKeyToIso(dateKey: string, part: "start" | "end" = "start"): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(part === "start" ? Date.UTC(year, month - 1, day) : Date.UTC(year, month - 1, day, 23, 59, 59)).toISOString();
}

type EventBase = Omit<RecoveryEvent, "occurredAt" | "meta"> & { occurredAt: Date | string; meta?: RecoveryMeta | null };

function make(base: EventBase): RecoveryEvent {
  return {
    ...base,
    occurredAt: typeof base.occurredAt === "string" ? base.occurredAt : base.occurredAt.toISOString(),
    detail: base.detail ? clip(base.detail) : null,
    meta: base.meta ?? null,
  };
}

/* ------------------------------------------------------------------ builders (shared by the log and the derivation) */

export function analysisEvent(report: {
  id: string;
  createdAt: Date | string;
  primarySymptoms: string;
  conditionTitle: string | null;
  conditionSummary: string | null;
  isFirst: boolean;
}): RecoveryEvent {
  const condition = report.conditionTitle ?? "condition not identified yet";
  return make({
    key: `analysis:${report.id}`,
    kind: "analysis",
    title: `${report.isFirst ? "First analysis" : "New analysis"}: ${condition}`,
    detail: [report.conditionSummary, report.primarySymptoms ? `Symptoms reported: ${report.primarySymptoms}` : null].filter(Boolean).join(" "),
    occurredAt: report.createdAt,
    dateKey: null,
    reportId: report.id,
  });
}

export function planEvent(input: {
  reportId: string;
  createdAt: Date | string;
  plan: Pick<StoredTreatmentPlan, "durationMonths" | "phases" | "steps">;
  rerun: boolean;
}): RecoveryEvent {
  const created = typeof input.createdAt === "string" ? new Date(input.createdAt) : input.createdAt;
  const phases = input.plan.phases.map((phase) => phase.phase).join(", ");
  const moves = input.plan.steps.map((step) => step.exerciseName).join(", ");
  return make({
    key: `plan:${input.reportId}:${created.getTime()}`,
    kind: "plan",
    title: input.rerun ? "Plan updated after re-running the analysis" : "Treatment plan created",
    detail: `${input.plan.durationMonths}-month plan${phases ? `: ${phases}` : ""}. Starts with ${moves}.`,
    occurredAt: created,
    dateKey: null,
    reportId: input.reportId,
  });
}

export function weekEvent(input: {
  reportId: string;
  weekNumber: number;
  phase: { phase: string; tagline: string } | null;
  dateKey: string | null;
  at: Date | string;
}): RecoveryEvent {
  return make({
    key: `week:${input.reportId}:${input.weekNumber}`,
    kind: "week",
    title: input.phase ? `Week ${input.weekNumber} began: ${input.phase.phase} phase` : `Week ${input.weekNumber} began`,
    detail: input.phase?.tagline ?? null,
    occurredAt: input.at,
    dateKey: input.dateKey,
    reportId: input.reportId,
  });
}

export function phaseEvent(input: { reportId: string; phaseIndex: number; phase: { phase: string; tagline: string }; dateKey: string }): RecoveryEvent {
  return make({
    key: `phase:${input.reportId}:${input.phaseIndex}`,
    kind: "week",
    title: `Month ${input.phaseIndex + 1} began: ${input.phase.phase}`,
    detail: input.phase.tagline,
    occurredAt: dayKeyToIso(input.dateKey),
    dateKey: input.dateKey,
    reportId: input.reportId,
  });
}

export function missedDayEvent(input: { reportId: string; dateKey: string }): RecoveryEvent {
  return make({
    key: `missed:${input.reportId}:${input.dateKey}`,
    kind: "missed_day",
    title: "Missed day: the plan moved forward",
    detail: "No exercises were logged, so the session was repeated on the next working day.",
    occurredAt: dayKeyToIso(input.dateKey, "end"),
    dateKey: input.dateKey,
    reportId: input.reportId,
  });
}

export function sessionEvent(input: { reportId: string; dateKey: string; exercises: readonly string[]; at: Date | string }): RecoveryEvent {
  const names = list(input.exercises);
  return make({
    key: `session:${input.reportId}:${input.dateKey}`,
    kind: "session",
    title: "Session completed",
    detail: names ? `${input.exercises.length} exercise${input.exercises.length === 1 ? "" : "s"} done: ${names}.` : null,
    occurredAt: input.at,
    dateKey: input.dateKey,
    reportId: input.reportId,
  });
}

export function feedbackEvent(input: {
  reportId: string;
  dateKey: string;
  feedback: FeedbackValue;
  discomfortExercises: readonly string[];
  discomfortDetails: string | null;
  notes: string | null;
  at: Date | string;
}): RecoveryEvent {
  const parts: string[] = [];
  if (input.feedback === "issue") {
    const where = list(input.discomfortExercises);
    if (where) parts.push(`Discomfort with ${where}.`);
    if (input.discomfortDetails) parts.push(input.discomfortDetails);
  }
  if (input.notes) parts.push(`Note: ${input.notes}`);
  return make({
    key: `feedback:${input.reportId}:${input.dateKey}`,
    kind: "feedback",
    title: FEEDBACK_TITLES[input.feedback],
    detail: parts.join(" ") || null,
    occurredAt: input.at,
    dateKey: input.dateKey,
    reportId: input.reportId,
    meta: { feedback: input.feedback },
  });
}

export function painOverrideEvent(input: {
  id: string;
  reportId: string;
  dateKey: string;
  painType: string;
  regions: readonly string[];
  exerciseNames: readonly string[];
  details: string;
  at: Date | string;
}): RecoveryEvent {
  const label = (PAIN_TYPE_LABELS as Record<string, string>)[input.painType] ?? words(input.painType);
  const where = list(input.regions.map(words));
  const during = list(input.exerciseNames);
  return make({
    key: `pain:${input.id}`,
    kind: "pain_override",
    title: "Pain Override: the session was stopped",
    detail: `${label}${where ? ` in the ${where}` : ""}${during ? ` during ${during}` : ""}. ${input.details}`,
    occurredAt: input.at,
    dateKey: input.dateKey,
    reportId: input.reportId,
    meta: { regions: [...input.regions], painType: input.painType },
  });
}

export function adjustEvent(input: { reportId: string; dateKey: string; cause: "feedback" | "pain"; at: Date | string }): RecoveryEvent {
  return make({
    key: `adjust:${input.reportId}:${input.dateKey}`,
    kind: "plan_adjusted",
    title: input.cause === "pain" ? "Plan adjusted after Pain Override" : "Plan adjusted after more discomfort",
    detail: "The remaining days were rebuilt to avoid what hurt.",
    occurredAt: input.at,
    dateKey: input.dateKey,
    reportId: input.reportId,
  });
}

export function precautionEvent(input: { reportId: string; updatedAt: string; badge: string; items: readonly string[] }): RecoveryEvent {
  return make({
    key: `precaution:${input.reportId}:${input.updatedAt}`,
    kind: "precaution",
    title: `Precautions updated: ${input.badge.replace(/^Updated /, "").replace(/\s+•\s+|\s{2,}/g, " ")}`,
    detail: input.items.slice(0, 2).join(" "),
    occurredAt: input.updatedAt,
    dateKey: null,
    reportId: input.reportId,
  });
}

export function escalationEvent(input: { reportId: string; at: Date | string; reason: string | null }): RecoveryEvent {
  return make({
    key: `escalation:${input.reportId}`,
    kind: "escalation",
    title: "Guided exercises paused: in-person care advised",
    detail: input.reason,
    occurredAt: input.at,
    dateKey: null,
    reportId: input.reportId,
  });
}

export const CHAT_CATEGORY_TITLES = {
  new_symptom: "New symptom mentioned in chat",
  pain_trigger: "Pain trigger mentioned in chat",
  movement_difficulty: "Trouble with a movement mentioned in chat",
  improvement: "Improvement mentioned in chat",
  worsening: "Worsening mentioned in chat",
} as const;

export type ChatCategory = keyof typeof CHAT_CATEGORY_TITLES;

export function chatInsightEvent(input: { messageId: string; reportId: string | null; category: ChatCategory; text: string; at: Date | string }): RecoveryEvent {
  return make({
    key: `chat:${input.messageId}`,
    kind: "chat_insight",
    title: CHAT_CATEGORY_TITLES[input.category],
    detail: `"${clip(input.text, 240)}"`,
    occurredAt: input.at,
    dateKey: null,
    reportId: input.reportId,
    meta: input.category === "improvement" ? { feedback: "relief" } : input.category === "worsening" ? { feedback: "issue" } : null,
  });
}

/* ------------------------------------------------------------------ derivation from the stored history */

export type DerivedReport = {
  id: string;
  createdAt: Date;
  primarySymptoms: string;
  conditionTitle: string | null;
  conditionSummary: string | null;
  escalatedAt: Date | null;
  escalationReason: string | null;
  plan: StoredTreatmentPlan | null;
  planCreatedAt: Date | null;
  dynamic: DynamicPrecautions | null;
};

export type DerivedProgress = {
  reportId: string;
  dateKey: string;
  completedExercises: string[];
  completedAt: Date | null;
  feedback: string | null;
  notes: string | null;
  discomfortExercises: string[];
  discomfortDetails: string | null;
  rescheduledAt: Date | null;
  updatedAt: Date;
};

export type DerivedPainEvent = {
  id: string;
  reportId: string;
  dateKey: string;
  painType: string;
  regions: string[];
  exerciseNames: string[];
  details: string;
  createdAt: Date;
  rescheduledAt: Date | null;
};

function isFeedback(value: string | null): value is FeedbackValue {
  return value === "relief" || value === "same" || value === "issue";
}

/** Every event the stored history shows, so an account that predates the log still gets its full timeline. */
export function deriveRecoveryEvents(
  data: { reports: readonly DerivedReport[]; progress: readonly DerivedProgress[]; painEvents: readonly DerivedPainEvent[] },
  todayKey: string,
): RecoveryEvent[] {
  const events: RecoveryEvent[] = [];
  const reports = [...data.reports].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  reports.forEach((report, index) => {
    events.push(
      analysisEvent({
        id: report.id,
        createdAt: report.createdAt,
        primarySymptoms: report.primarySymptoms,
        conditionTitle: report.conditionTitle,
        conditionSummary: report.conditionSummary,
        isFirst: index === 0,
      }),
    );
    if (report.escalatedAt) {
      events.push(escalationEvent({ reportId: report.id, at: report.escalatedAt, reason: report.escalationReason }));
    }
    if (!report.plan) return;

    if (report.planCreatedAt) {
      events.push(planEvent({ reportId: report.id, createdAt: report.planCreatedAt, plan: report.plan, rerun: false }));
    }

    // Week and month changes, up to today, the end of the plan, or the day a newer intake took over.
    const startKey = report.plan.startDateKey ?? (report.planCreatedAt ?? report.createdAt).toISOString().slice(0, 10);
    const next = reports[index + 1];
    const lengthDays = report.plan.durationMonths * 30;
    let lastKey = shiftDateKey(startKey, lengthDays - 1);
    if (todayKey < lastKey) lastKey = todayKey;
    if (next) {
      const takeover = next.createdAt.toISOString().slice(0, 10);
      if (takeover < lastKey) lastKey = takeover;
    }
    const lastDay = planDayNumber(startKey, lastKey);
    const phaseCount = report.plan.phases.length;
    for (let day = 8; day <= lastDay; day += 7) {
      const weekNumber = weekOfPlan(day);
      const phase = report.plan.phases[phaseIndexOf(day, phaseCount)] ?? null;
      const dateKey = shiftDateKey(startKey, day - 1);
      events.push(weekEvent({ reportId: report.id, weekNumber, phase, dateKey, at: dayKeyToIso(dateKey) }));
    }
    for (let phaseIndex = 1; phaseIndex < phaseCount && phaseIndex * 30 + 1 <= lastDay; phaseIndex += 1) {
      events.push(
        phaseEvent({ reportId: report.id, phaseIndex, phase: report.plan.phases[phaseIndex], dateKey: shiftDateKey(startKey, phaseIndex * 30) }),
      );
    }

    for (const dateKey of report.plan.skippedDays ?? []) {
      events.push(missedDayEvent({ reportId: report.id, dateKey }));
    }

    const dynamic = report.dynamic;
    if (dynamic && dynamic.kind !== "initial" && dynamic.kind !== "week") {
      events.push(precautionEvent({ reportId: report.id, updatedAt: dynamic.updatedAt, badge: dynamic.badge, items: dynamic.items }));
    }
  });

  for (const row of data.progress) {
    if (row.completedAt) {
      events.push(sessionEvent({ reportId: row.reportId, dateKey: row.dateKey, exercises: row.completedExercises, at: row.completedAt }));
    }
    if (isFeedback(row.feedback)) {
      events.push(
        feedbackEvent({
          reportId: row.reportId,
          dateKey: row.dateKey,
          feedback: row.feedback,
          discomfortExercises: row.discomfortExercises,
          discomfortDetails: row.discomfortDetails,
          notes: row.notes,
          at: row.completedAt ?? row.updatedAt,
        }),
      );
    }
    if (row.rescheduledAt) {
      events.push(adjustEvent({ reportId: row.reportId, dateKey: row.dateKey, cause: "feedback", at: row.rescheduledAt }));
    }
  }

  for (const pain of data.painEvents) {
    events.push(
      painOverrideEvent({
        id: pain.id,
        reportId: pain.reportId,
        dateKey: pain.dateKey,
        painType: pain.painType,
        regions: pain.regions,
        exerciseNames: pain.exerciseNames,
        details: pain.details,
        at: pain.createdAt,
      }),
    );
  }

  return events;
}

/** For events at the same moment: what led to something comes before it (a session before its feedback). */
const KIND_ORDER: readonly RecoveryKind[] = [
  "analysis",
  "plan",
  "week",
  "session",
  "feedback",
  "pain_override",
  "plan_adjusted",
  "precaution",
  "missed_day",
  "chat_insight",
  "escalation",
];

/** Logged events and derived ones as one list, oldest first. A logged event wins over a derived one with the same key. */
export function mergeRecoveryEvents(logged: readonly RecoveryEvent[], derived: readonly RecoveryEvent[]): RecoveryEvent[] {
  const byKey = new Map<string, RecoveryEvent>();
  for (const event of derived) byKey.set(event.key, event);
  for (const event of logged) byKey.set(event.key, event);
  return [...byKey.values()].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.key.localeCompare(b.key),
  );
}

/* ------------------------------------------------------------------ trends */

export type TimelineTrends = {
  sessionsCompleted: number;
  feedback: { relief: number; same: number; issue: number };
  painOverrides: number;
  painRegions: { region: string; count: number }[];
  missedDays: number;
  planAdjustments: number;
  chatInsights: number;
  /** feedback in time order, for a small trend line */
  feedbackSeries: { dateKey: string; feedback: FeedbackValue }[];
};

export function summarizeTrends(events: readonly RecoveryEvent[]): TimelineTrends {
  const trends: TimelineTrends = {
    sessionsCompleted: 0,
    feedback: { relief: 0, same: 0, issue: 0 },
    painOverrides: 0,
    painRegions: [],
    missedDays: 0,
    planAdjustments: 0,
    chatInsights: 0,
    feedbackSeries: [],
  };
  const regions = new Map<string, number>();
  for (const event of events) {
    switch (event.kind) {
      case "session":
        trends.sessionsCompleted += 1;
        break;
      case "feedback":
        if (event.meta?.feedback) {
          trends.feedback[event.meta.feedback] += 1;
          trends.feedbackSeries.push({ dateKey: event.dateKey ?? event.occurredAt.slice(0, 10), feedback: event.meta.feedback });
        }
        break;
      case "pain_override":
        trends.painOverrides += 1;
        for (const region of event.meta?.regions ?? []) regions.set(region, (regions.get(region) ?? 0) + 1);
        break;
      case "missed_day":
        trends.missedDays += 1;
        break;
      case "plan_adjusted":
        trends.planAdjustments += 1;
        break;
      case "chat_insight":
        trends.chatInsights += 1;
        break;
      default:
        break;
    }
  }
  trends.painRegions = [...regions].map(([region, count]) => ({ region: words(region), count })).sort((a, b) => b.count - a.count);
  return trends;
}

/* ------------------------------------------------------------------ what the dashboard and the export show */

export type RecoveryTimeline = {
  patient: { name: string; email: string };
  generatedAt: string;
  /** Oldest first. */
  events: RecoveryEvent[];
  trends: TimelineTrends;
  condition: {
    title: string | null;
    summary: string | null;
    symptoms: string;
    startedAt: string;
    requiresInPersonCare: boolean;
    careReason: string | null;
  } | null;
  plan: {
    durationMonths: number;
    phases: { phase: string; tagline: string }[];
    startDateKey: string | null;
    dayNumber: number | null;
    weekNumber: number | null;
    phaseName: string | null;
  } | null;
  precautions: { permanent: string[]; dynamic: string[]; dynamicBadge: string | null } | null;
};
