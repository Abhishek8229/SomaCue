import { z } from "zod";
import type { TreatmentPlan } from "@/actions/generatePlan";
import type { Escalation } from "@/lib/clinical/assessment";

/*
 * Pure helpers shared by the daily prescription UI and the server actions.
 * Keep this file free of "use server" and server-only imports so client
 * components can import it.
 */

export type ExerciseStep = TreatmentPlan["steps"][number];
export type ScheduleDayWithSteps = TreatmentPlan["schedule"]["days"][number] & {
  steps?: ExerciseStep[];
};
export type ScheduleWithSteps = {
  horizonDays: number;
  days: ScheduleDayWithSteps[];
};
/** Shown once when days passed with no exercise done. */
export type SkipNotice = {
  /** The skipped working days, oldest first. */
  dateKeys: string[];
  /** How many days the plan moved forward to repeat the missed sessions. */
  shiftedDays: number;
  /** The local date the skip was noticed on. */
  noticedOn: string;
  dismissed: boolean;
};
export type RescheduledSchedule = {
  horizonDays: number;
  days: Array<TreatmentPlan["schedule"]["days"][number] & { steps: ExerciseStep[] }>;
};
/** A routine as stored in the database. Older routines have no schedule or per-day steps. */
export type StoredTreatmentPlan = Omit<TreatmentPlan, "schedule"> & {
  schedule?: ScheduleWithSteps;
  /** Local date of Day 1, the day the analysis was run. */
  startDateKey?: string;
  /** Local date that the schedule's dayOffset 0 stands for. */
  scheduleAnchor?: string;
  /** Working days that passed with no exercise done, for the history. */
  skippedDays?: string[];
  skipNotice?: SkipNotice | null;
  /**
   * The schedule days after today as they were before each "More discomfort"
   * reschedule, keyed by the date of that session. Reset restores from here.
   * null means the plan had no stored schedule at that time.
   */
  rescheduleBackups?: Record<string, ScheduleDayWithSteps[] | null>;
};

export type FeedbackChoice = "relief" | "same" | "issue";

/** A failed action. rror is PRO_REQUIRED (with the eature) when only a Pro plan may do it. */
export type ActionFailure = { success: false; error: string; feature?: import("@/lib/billing/plans").ProFeature };
export type ToggleExerciseResult =
  | { success: true; completedExercises: string[] }
  | ActionFailure;
export type ResetDayResult =
  | {
      success: true;
      /** Present when the reset also changed the schedule. null means no stored schedule. */
      schedule?: ScheduleWithSteps | null;
    }
  | ActionFailure;
export type SubmitFeedbackResult =
  | {
      success: true;
      rescheduled: true;
      schedule: ScheduleWithSteps;
      escalation?: null;
      /** The dynamic precautions rebuilt after this feedback, for the sidebar. */
      dynamicPrecautions?: import("@/lib/precautions/precautions").DynamicPrecautions | null;
    }
  | {
      success: true;
      rescheduled: false;
      dynamicPrecautions?: import("@/lib/precautions/precautions").DynamicPrecautions | null;
      rescheduleError?: "AI_PROVIDER_FAILED" | "AI_PROVIDER_TIMEOUT";
      /** Set when this feedback showed the case needs in-person care. */
      escalation?: Escalation | null;
    }
  | ActionFailure;

export type DailyProgressRecord = {
  dateKey: string;
  completedExercises: string[];
  completed: boolean;
  feedback: FeedbackChoice | null;
  /** stopped with Pain Override; never counts as completed */
  stopped?: boolean;
  /** regions from the latest stop report of the day, for the red glow */
  stopRegions?: string[];
};

export const FEEDBACK_TEXT_MAX = 1000;
export const FEEDBACK_OPTIONS: ReadonlyArray<{ value: FeedbackChoice; label: string }> = [
  { value: "relief", label: "More relief" },
  { value: "same", label: "About the same" },
  { value: "issue", label: "More discomfort" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Zero-padded local calendar date, for example 2026-11-04. */
export function toDateKey(date: Date) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  return isReal ? utc.getTime() : null;
}

export const dateKeySchema = z
  .string()
  .refine((value) => parseDateKey(value) !== null, "Enter a valid date in YYYY-MM-DD format.");

/**
 * The client sends its local date. Local and UTC dates never differ by more than
 * one day, so anything outside that window is rejected as a bad or forged date.
 */
export function isDateKeyNearToday(dateKey: string, now = new Date()) {
  const time = parseDateKey(dateKey);
  if (time === null) {
    return false;
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.abs(time - todayUtc) <= DAY_MS;
}

const optionalNotes = z
  .string()
  .trim()
  .max(FEEDBACK_TEXT_MAX)
  .optional();

export const feedbackSubmissionSchema = z.discriminatedUnion("feedback", [
  z.object({ feedback: z.literal("relief"), notes: optionalNotes }),
  z.object({ feedback: z.literal("same"), notes: optionalNotes }),
  z.object({
    feedback: z.literal("issue"),
    discomfortExercises: z.array(z.string().trim().min(1)).min(1).max(10),
    discomfortDetails: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX),
    notes: optionalNotes,
  }),
]);

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export type FeedbackDraft = {
  feedback: FeedbackChoice | null;
  notes: string;
  discomfortExercises: string[];
  discomfortDetails: string;
};

export type FeedbackDraftErrors = Partial<
  Record<"feedback" | "notes" | "discomfortExercises" | "discomfortDetails", string>
>;

/** Mirrors feedbackSubmissionSchema so the modal and the server agree. */
export function validateFeedbackDraft(draft: FeedbackDraft): {
  valid: boolean;
  errors: FeedbackDraftErrors;
} {
  const errors: FeedbackDraftErrors = {};

  if (draft.feedback === null) {
    errors.feedback = "Choose how the exercise felt.";
  } else if (draft.feedback === "issue") {
    if (draft.discomfortExercises.length === 0) {
      errors.discomfortExercises = "Select at least one exercise that caused discomfort.";
    }
    const details = draft.discomfortDetails.trim();
    if (details.length === 0) {
      errors.discomfortDetails = "Describe the discomfort or what triggered it.";
    } else if (details.length > FEEDBACK_TEXT_MAX) {
      errors.discomfortDetails = `Keep this under ${FEEDBACK_TEXT_MAX} characters.`;
    }
  } else if (draft.notes.trim().length > FEEDBACK_TEXT_MAX) {
    errors.notes = `Keep notes under ${FEEDBACK_TEXT_MAX} characters.`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function normalizeExerciseName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getDayExercises(
  plan: { steps: ExerciseStep[] },
  day: { status: string; steps?: ExerciseStep[] } | undefined,
) {
  if (day?.status === "rest") {
    return [];
  }

  return day?.steps?.length ? day.steps : plan.steps;
}

/** Every exercise name the plan can show on any day. */
export function collectExerciseNames(plan: {
  steps: ExerciseStep[];
  schedule?: { days: Array<{ steps?: ExerciseStep[] }> };
}) {
  const names = new Set(plan.steps.map((step) => step.exerciseName));
  plan.schedule?.days.forEach((day) =>
    day.steps?.forEach((step) => names.add(step.exerciseName)),
  );
  return names;
}

/**
 * Returns a reason when the AI schedule cannot be trusted, otherwise null.
 * Every non-rest day after today needs its own steps, and none of them may
 * contain an aggravating exercise unchanged.
 */
export function findRescheduleProblem(
  schedule: RescheduledSchedule,
  discomfortExercises: string[],
) {
  const blocked = new Set(discomfortExercises.map(normalizeExerciseName));

  for (const day of schedule.days) {
    if (day.dayOffset < 1 || day.status === "rest") {
      continue;
    }

    if (day.steps.length === 0) {
      return `Day ${day.dayOffset} has no exercises.`;
    }

    const repeated = day.steps.find((step) => blocked.has(normalizeExerciseName(step.exerciseName)));
    if (repeated) {
      return `Day ${day.dayOffset} still includes "${repeated.exerciseName}" unchanged.`;
    }
  }

  return null;
}

function toStoredDay(day: ScheduleDayWithSteps): ScheduleDayWithSteps {
  const { steps, ...rest } = day;
  const status = day.dayOffset >= 1 && day.status === "active" ? "upcoming" : day.status;
  return status !== "rest" && steps && steps.length > 0
    ? { ...rest, status, steps }
    : { ...rest, status };
}

/**
 * Keeps today's entry (dayOffset 0) as it is and takes every later day from the
 * AI result. A later day the AI left out falls back to the current entry.
 */
export function mergeRescheduledSchedule(
  current: ScheduleWithSteps | undefined,
  rescheduled: RescheduledSchedule,
): ScheduleWithSteps {
  const currentByOffset = new Map(current?.days.map((day) => [day.dayOffset, day]));
  const rescheduledByOffset = new Map(rescheduled.days.map((day) => [day.dayOffset, day]));
  const offsets = [
    ...new Set([...currentByOffset.keys(), ...rescheduledByOffset.keys()]),
  ].sort((left, right) => left - right);

  const days = offsets.flatMap((offset) => {
    const day =
      offset === 0
        ? (currentByOffset.get(0) ?? rescheduledByOffset.get(0))
        : (rescheduledByOffset.get(offset) ?? currentByOffset.get(offset));
    return day ? [toStoredDay(day)] : [];
  });

  return { horizonDays: days.length, days };
}

/** The plan without internal bookkeeping, for the AI prompt and the client. */
export function withoutBackups(plan: StoredTreatmentPlan): StoredTreatmentPlan {
  const copy = { ...plan };
  delete copy.rescheduleBackups;
  return copy;
}

/** Returns the backups with the pre-reschedule days after today saved for this date. */
export function recordRescheduleBackup(plan: StoredTreatmentPlan, dateKey: string) {
  const backups = { ...plan.rescheduleBackups };
  if (!(dateKey in backups)) {
    backups[dateKey] = plan.schedule
      ? plan.schedule.days.filter((day) => day.dayOffset >= 1)
      : null;
  }
  return backups;
}

export type ScheduleRestore =
  | { changed: false }
  | {
      changed: true;
      schedule: ScheduleWithSteps | null;
      rescheduleBackups: NonNullable<StoredTreatmentPlan["rescheduleBackups"]>;
    };

function withoutDaySteps(day: ScheduleDayWithSteps) {
  return Object.fromEntries(
    Object.entries(day).filter(([key]) => key !== "steps"),
  ) as ScheduleDayWithSteps;
}

/**
 * Undoes the schedule change made by this date's "More discomfort" feedback.
 * Uses the saved backup. Without one (older data), per-day exercises after
 * today are cleared so those days fall back to the base plan.
 */
export function restoreScheduleForReset(
  plan: StoredTreatmentPlan,
  dateKey: string,
  wasRescheduled: boolean,
): ScheduleRestore {
  const backups = plan.rescheduleBackups ?? {};

  if (dateKey in backups) {
    const remaining = { ...backups };
    const backup = remaining[dateKey];
    delete remaining[dateKey];
    if (backup === null) {
      return { changed: true, schedule: null, rescheduleBackups: remaining };
    }

    const today = plan.schedule?.days.filter((day) => day.dayOffset < 1) ?? [];
    const days = [...today, ...backup].sort((left, right) => left.dayOffset - right.dayOffset);
    return {
      changed: true,
      schedule: { horizonDays: days.length, days },
      rescheduleBackups: remaining,
    };
  }

  if (wasRescheduled && plan.schedule) {
    const days = plan.schedule.days.map((day) => (day.dayOffset >= 1 ? withoutDaySteps(day) : day));
    return {
      changed: true,
      schedule: { horizonDays: days.length, days },
      rescheduleBackups: backups,
    };
  }

  return { changed: false };
}

export function applyScheduleRestore(
  plan: StoredTreatmentPlan,
  restore: Extract<ScheduleRestore, { changed: true }>,
): StoredTreatmentPlan {
  const next: StoredTreatmentPlan = { ...plan, rescheduleBackups: restore.rescheduleBackups };
  if (restore.schedule) {
    next.schedule = restore.schedule;
  } else {
    delete next.schedule;
  }
  return next;
}
