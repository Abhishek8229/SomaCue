import type {
  ScheduleDayWithSteps,
  SkipNotice,
  StoredTreatmentPlan,
} from "./dailyProgress";

/*
 * Keeps a plan's schedule tied to the calendar.
 *
 * Day 1 is the day the analysis was run. The stored schedule always has
 * dayOffset 0 on `scheduleAnchor`. When days pass, this moves the anchor to
 * today. A working day with no exercise done is "skipped": its session is
 * pushed forward so today (and the days after it) repeat what was missed.
 *
 * Pure and clock-free: callers pass today's local date key, so it runs the
 * same on the server (when saving) and in the browser (to show it at once).
 */

const DAY_MS = 86_400_000;
/** How many days a schedule covers after it is rebuilt. */
export const SCHEDULE_HORIZON = 7;
/** How many missed sessions are replayed; further ones are only recorded. */
export const MAX_REPLAYED_SESSIONS = 3;

function keyToTime(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function shiftDateKey(dateKey: string, days: number): string {
  return new Date(keyToTime(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((keyToTime(toKey) - keyToTime(fromKey)) / DAY_MS);
}

/**
 * The viewer's calendar day for a timestamp, given Date.getTimezoneOffset()
 * (minutes the viewer's clock is behind UTC; 0 means UTC).
 */
export function isoToDateKey(iso: string, utcOffsetMinutes: number): string {
  return new Date(Date.parse(iso) - utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export type ProgressLike = {
  dateKey: string;
  completedExercises: string[];
  completed: boolean;
  stopped?: boolean;
};

export type ReconcileResult = {
  plan: StoredTreatmentPlan;
  /** True when the stored plan should be saved. */
  changed: boolean;
  /** Working days that passed with no exercise done, oldest first. */
  skippedDateKeys: string[];
  /** How many days the schedule moved forward to repeat missed sessions. */
  shiftedDays: number;
};

/** The schedule as stored, or the five-working-days-plus-two-rest default older plans use. */
export function baseScheduleDays(plan: StoredTreatmentPlan): ScheduleDayWithSteps[] {
  if (plan.schedule?.days.length) {
    return [...plan.schedule.days].sort((left, right) => left.dayOffset - right.dayOffset);
  }
  const phase = plan.phases[0];
  return Array.from({ length: SCHEDULE_HORIZON }, (_, dayOffset) => ({
    dayOffset,
    status: dayOffset === 0 ? ("active" as const) : dayOffset > 4 ? ("rest" as const) : ("upcoming" as const),
    focus: dayOffset > 4 ? "Recovery" : (phase?.phase ?? "Baseline"),
    tagline: dayOffset > 4 ? "Pause and let your body recover." : (phase?.tagline ?? "Follow your gentle baseline plan."),
  }));
}

/** The entry for a day offset; past the stored days the weekly pattern repeats. */
function entryAt(days: ScheduleDayWithSteps[], offset: number): ScheduleDayWithSteps {
  return days.find((day) => day.dayOffset === offset) ?? days[((offset % days.length) + days.length) % days.length];
}

/** A session counts as attempted when any exercise was ticked, the day was finished or Pain Override stopped it. */
function wasAttempted(row: ProgressLike | undefined): boolean {
  return row !== undefined && (row.completed || row.completedExercises.length > 0 || row.stopped === true);
}

export function reconcileSchedule(
  plan: StoredTreatmentPlan,
  progress: ProgressLike[],
  todayKey: string,
  /** Local date of plan creation, used for plans saved before the schedule was dated. */
  fallbackStartKey: string,
): ReconcileResult {
  const startDateKey = plan.startDateKey ?? fallbackStartKey;
  const anchor = plan.scheduleAnchor ?? startDateKey;
  const gap = daysBetween(anchor, todayKey);
  const datedBefore = plan.startDateKey !== undefined && plan.scheduleAnchor !== undefined;

  if (gap <= 0) {
    return {
      plan: datedBefore ? plan : { ...plan, startDateKey, scheduleAnchor: anchor },
      changed: !datedBefore,
      skippedDateKeys: [],
      shiftedDays: 0,
    };
  }

  const days = baseScheduleDays(plan);
  const byDate = new Map(progress.map((row) => [row.dateKey, row]));

  const skippedDateKeys: string[] = [];
  const missed: ScheduleDayWithSteps[] = [];
  for (let offset = 0; offset < gap; offset += 1) {
    const entry = entryAt(days, offset);
    if (entry.status === "rest") continue;
    const dateKey = shiftDateKey(anchor, offset);
    if (!wasAttempted(byDate.get(dateKey))) {
      skippedDateKeys.push(dateKey);
      missed.push(entry);
    }
  }

  const replayed = missed.slice(0, MAX_REPLAYED_SESSIONS);
  const rebuilt: ScheduleDayWithSteps[] = Array.from({ length: SCHEDULE_HORIZON }, (_, index) => {
    const source = index < replayed.length ? replayed[index] : entryAt(days, gap + index - replayed.length);
    return {
      ...source,
      dayOffset: index,
      status: source.status === "rest" ? "rest" : index === 0 ? "active" : "upcoming",
    };
  });

  const next: StoredTreatmentPlan = {
    ...plan,
    startDateKey,
    scheduleAnchor: todayKey,
    schedule: { horizonDays: rebuilt.length, days: rebuilt },
    skippedDays: [...new Set([...(plan.skippedDays ?? []), ...skippedDateKeys])].slice(-60),
    skipNotice: skippedDateKeys.length
      ? { dateKeys: skippedDateKeys.slice(-7), shiftedDays: replayed.length, noticedOn: todayKey, dismissed: false }
      : (plan.skipNotice ?? null),
  };
  // Backups point at old offsets; they only ever restored a past day's reschedule.
  delete next.rescheduleBackups;

  return { plan: next, changed: true, skippedDateKeys, shiftedDays: replayed.length };
}

function monthDay(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The words shown on the "day skipped" alert. */
export function describeSkipNotice(notice: SkipNotice): { title: string; body: string } {
  const dates = notice.dateKeys.map(monthDay);
  const title =
    dates.length === 1
      ? `You skipped ${dates[0]}`
      : `You skipped ${dates.length} days: ${dates.slice(0, -1).join(", ")} and ${dates[dates.length - 1]}`;
  const moved =
    notice.shiftedDays === 1
      ? "Your plan moved forward one day, so today repeats the session you missed."
      : `Your plan moved forward ${notice.shiftedDays} days, so the next sessions repeat the ones you missed.`;
  return { title, body: `No exercises were logged. ${moved}` };
}

export function activeSkipNotice(plan: StoredTreatmentPlan | null | undefined): SkipNotice | null {
  const notice = plan?.skipNotice;
  return notice && !notice.dismissed ? notice : null;
}
