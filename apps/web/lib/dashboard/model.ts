import {
  CONDITION_SOURCE_LABELS,
  ESCALATION_RULES,
  isConditionSource,
} from "@/lib/clinical/assessment";
import { describeSpec, resolveStageExercise } from "@/lib/kinematics/exercise";
import { REGION_LABELS, type Region } from "@/lib/kinematics/vocabulary";
import {
  getDayExercises,
  normalizeExerciseName,
  type ExerciseStep,
  type ScheduleDayWithSteps,
} from "@/lib/progress/dailyProgress";
import {
  activeSkipNotice,
  baseScheduleDays,
  daysBetween,
  describeSkipNotice,
  isoToDateKey,
  reconcileSchedule,
  shiftDateKey,
} from "@/lib/progress/schedule";
import type {
  DashboardModel,
  DashboardProgressRow,
  DashboardReport,
  DashboardSnapshot,
  GuardrailMeter,
  HistoryEntry,
  PatientRecord,
  RecentDayState,
  TodayExercise,
  TodayStatus,
  TrendPoint,
  WeekDay,
} from "./types";

/*
 * Pure functions that turn database rows into what the dashboard shows.
 * Nothing here reads the clock or the database: "today" is passed in as a
 * YYYY-MM-DD key, the same local-date key the workspace writes to DailyProgress.
 */

const RECENT_DAYS = 14;
const TREND_POINTS = 14;
const DAYS_PER_MONTH = 30;

export { daysBetween, shiftDateKey };

function keyToTime(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function weekdayShort(dateKey: string): string {
  return new Date(keyToTime(dateKey)).toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
}

function pluralize(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The newest report is the active program; older ones are history. */
function activeReport(snapshot: DashboardSnapshot): DashboardReport | null {
  return snapshot.reports[0] ?? null;
}

function regionLabel(value: string): string {
  return (REGION_LABELS as Record<string, string>)[value] ?? value.replaceAll("_", " ");
}

function stepsForToday(report: DashboardReport) {
  const plan = report.plan;
  if (!plan) return { day: undefined, steps: [] as ExerciseStep[] };
  const day: ScheduleDayWithSteps | undefined = plan.schedule?.days.find((entry) => entry.dayOffset === 0);
  return { day, steps: getDayExercises(plan, day) };
}

function describeStep(step: ExerciseStep): Pick<TodayExercise, "dose" | "pacing"> {
  const exercise = resolveStageExercise(step);
  if (!exercise.spec) return { dose: null, pacing: null };
  const { dose, tempo } = describeSpec(exercise.spec);
  return { dose, pacing: tempo };
}

function planRegions(report: DashboardReport): string[] {
  const plan = report.plan;
  if (!plan) return [];
  const steps = [...plan.steps, ...(plan.schedule?.days.flatMap((day) => day.steps ?? []) ?? [])];
  const found = new Set<Region>();
  for (const step of steps) {
    resolveStageExercise(step).spec?.targetRegions.forEach((region) => found.add(region));
  }
  return [...found].map((region) => REGION_LABELS[region]);
}

function buildToday(report: DashboardReport | null, progress: DashboardProgressRow[], todayKey: string): DashboardModel["today"] {
  const base = {
    dateKey: todayKey,
    focus: null,
    tagline: null,
    exercises: [] as TodayExercise[],
    completedCount: 0,
    feedback: null,
  };
  if (!report?.plan) return { ...base, status: "none" };
  if (report.escalation) return { ...base, status: "locked" };

  const { day, steps } = stepsForToday(report);
  const row = progress.find((entry) => entry.dateKey === todayKey);
  const done = new Set((row?.completedExercises ?? []).map(normalizeExerciseName));
  const exercises: TodayExercise[] = steps.map((step) => ({
    name: step.exerciseName,
    durationSeconds: step.durationSeconds,
    done: done.has(normalizeExerciseName(step.exerciseName)),
    ...describeStep(step),
  }));
  const completedCount = exercises.filter((exercise) => exercise.done).length;

  let status: TodayStatus;
  if (row?.stopped) status = "stopped";
  else if (day?.status === "rest" || exercises.length === 0) status = "rest";
  else if (row?.completed || completedCount === exercises.length) status = "completed";
  else if (completedCount > 0) status = "partial";
  else status = "pending";

  return {
    dateKey: todayKey,
    status,
    focus: day?.focus ?? report.plan.phases[0]?.phase ?? null,
    tagline: day?.tagline ?? report.plan.phases[0]?.tagline ?? null,
    exercises,
    completedCount,
    feedback: row?.feedback ?? null,
  };
}

function buildWeek(report: DashboardReport | null, today: DashboardModel["today"], todayKey: string): WeekDay[] {
  if (!report?.plan || report.escalation) return [];
  return baseScheduleDays(report.plan).map((day) => {
    const dateKey = shiftDateKey(todayKey, day.dayOffset);
    let state: WeekDay["state"];
    if (day.dayOffset === 0) {
      state = today.status === "completed" ? "completed" : today.status === "stopped" ? "stopped" : today.status === "rest" ? "rest" : "today";
    } else {
      state = day.status === "rest" ? "rest" : "upcoming";
    }
    return {
      dateKey,
      weekday: weekdayShort(dateKey),
      dayOfMonth: Number(dateKey.slice(8, 10)),
      state,
      focus: day.focus,
      isToday: day.dayOffset === 0,
    };
  });
}

function streaks(completedKeys: Set<string>, todayKey: string) {
  // A streak is still alive if today is not done yet but yesterday was.
  let cursor = completedKeys.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let current = 0;
  while (completedKeys.has(cursor)) {
    current += 1;
    cursor = shiftDateKey(cursor, -1);
  }

  const sorted = [...completedKeys].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const key of sorted) {
    run = previous && daysBetween(previous, key) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return { current, best };
}

function buildAdherence(
  report: DashboardReport | null,
  snapshot: DashboardSnapshot,
  todayKey: string,
  utcOffsetMinutes: number,
): DashboardModel["adherence"] {
  const completedKeys = new Set(snapshot.progress.filter((row) => row.completed).map((row) => row.dateKey));
  const stoppedKeys = new Set([
    ...snapshot.progress.filter((row) => row.stopped).map((row) => row.dateKey),
    ...snapshot.painEvents.map((event) => event.dateKey),
  ]);
  const { current, best } = streaks(completedKeys, todayKey);

  const recent = Array.from({ length: RECENT_DAYS }, (_, index) => {
    const dateKey = shiftDateKey(todayKey, index - (RECENT_DAYS - 1));
    const state: RecentDayState = completedKeys.has(dateKey) ? "completed" : stoppedKeys.has(dateKey) ? "stopped" : "none";
    return { dateKey, state };
  });

  const startKey = report
    ? (report.plan?.startDateKey ?? isoToDateKey(report.planCreatedAt ?? report.createdAt, utcOffsetMinutes))
    : null;
  return {
    completedSessions: completedKeys.size,
    stoppedSessions: stoppedKeys.size,
    currentStreak: current,
    bestStreak: best,
    daysSinceStart: startKey ? Math.max(0, daysBetween(startKey, todayKey)) : null,
    recent,
    recentCompleted: recent.filter((day) => day.state === "completed").length,
  };
}

function buildTrend(snapshot: DashboardSnapshot): DashboardModel["trend"] {
  const stopKeys = new Set([
    ...snapshot.progress.filter((row) => row.stopped).map((row) => row.dateKey),
    ...snapshot.painEvents.map((event) => event.dateKey),
  ]);
  const checkIns = snapshot.progress
    .filter((row): row is DashboardProgressRow & { feedback: NonNullable<DashboardProgressRow["feedback"]> } => row.feedback !== null)
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  const counts = { relief: 0, same: 0, issue: 0, stops: stopKeys.size };
  for (const row of checkIns) counts[row.feedback] += 1;

  const points: TrendPoint[] = checkIns.slice(-TREND_POINTS).map((row) => ({
    dateKey: row.dateKey,
    feedback: row.feedback,
    level: row.feedback === "relief" ? 1 : row.feedback === "issue" ? -1 : 0,
    stopped: stopKeys.has(row.dateKey),
  }));
  return { points, counts };
}

function buildGuardrail(
  report: DashboardReport | null,
  snapshot: DashboardSnapshot,
  todayKey: string,
): DashboardModel["guardrail"] {
  if (!report) {
    return {
      state: "standard",
      title: "Standard progression",
      detail: "Safety checks start with your first intake. Red-flag screening runs before any plan is made.",
      meters: [],
      evidence: [],
    };
  }

  if (report.escalation) {
    return {
      state: "escalated",
      title: report.escalation.kind === "triage" ? "In-person care advised" : "Guided exercises paused",
      detail: report.escalation.reason,
      meters: [],
      evidence: report.escalation.evidence,
    };
  }
  if (report.requiresInPersonCare) {
    return {
      state: "escalated",
      title: "In-person care advised",
      detail: report.careReason ?? "Triage found that this case needs an in-person medical evaluation.",
      meters: [],
      evidence: [],
    };
  }

  const stopKeys = [...new Set([
    ...snapshot.progress.filter((row) => row.stopped).map((row) => row.dateKey),
    ...snapshot.painEvents.map((event) => event.dateKey),
  ])].sort();

  const rules = ESCALATION_RULES;
  const recentStops = stopKeys.filter((key) => {
    const age = daysBetween(key, todayKey);
    return age >= 0 && age < rules.painStopWindowDays;
  });

  const sessions = new Map<string, boolean>();
  for (const row of snapshot.progress) {
    if (row.feedback) sessions.set(row.dateKey, row.feedback === "issue");
  }
  for (const key of stopKeys) sessions.set(key, true);
  const ordered = [...sessions.entries()].sort(([left], [right]) => left.localeCompare(right));
  let trailingNegative = 0;
  for (let index = ordered.length - 1; index >= 0 && ordered[index][1]; index -= 1) trailingNegative += 1;

  const meters: GuardrailMeter[] = report.plan
    ? [
        { label: `Pain Override days in the last ${rules.painStopWindowDays}`, value: recentStops.length, limit: rules.painStopDays },
        { label: "Latest sessions in a row with pain or worsening", value: Math.min(trailingNegative, rules.consecutiveNegative), limit: rules.consecutiveNegative },
      ]
    : [];

  const latestStop = stopKeys.at(-1);
  if (latestStop && daysBetween(latestStop, todayKey) <= 1 && daysBetween(latestStop, todayKey) >= 0) {
    const event = snapshot.painEvents.filter((entry) => entry.dateKey === latestStop).at(-1);
    const regions = event?.regions.map(regionLabel) ?? [];
    return {
      state: "hold",
      title: "Pain Override hold active",
      detail: `You used Pain Override on ${latestStop}. The next day was rescheduled conservatively${
        regions.length ? ` and later exercises that load ${regions.join(", ").toLowerCase()} were removed` : ""
      }.`,
      meters,
      evidence: [],
    };
  }

  return {
    state: "standard",
    title: "Standard progression",
    detail: report.plan
      ? "No Pain Override hold or red-flag advisory is active."
      : "Your plan is not ready yet. Red-flag screening has not found a reason to stop.",
    meters,
    evidence: [],
  };
}

function fileType(url: string): string {
  const match = /\.([a-z0-9]{1,5})(?:[?#].*)?$/i.exec(url);
  return match ? match[1].toUpperCase() : "File";
}

function buildRecords(reports: DashboardReport[]): PatientRecord[] {
  const records: PatientRecord[] = [];
  for (const report of reports) {
    const groups: Array<[PatientRecord["category"], string, string, string[]]> = [
      ["prescription", "Clinician notes", "Clinician note", report.prescriptionUrls],
      ["scan", "Imaging scans", "Scan", report.scanUrls],
      ["other", "Earlier uploads", "Report file", report.uncategorizedUrls],
    ];
    // Position of each group in the list the download route uses: scans, then prescriptions, then the rest.
    const offsets = {
      scan: 0,
      prescription: report.scanUrls.length,
      other: report.scanUrls.length + report.prescriptionUrls.length,
    } as const;
    for (const [category, categoryLabel, noun, urls] of groups) {
      urls.forEach((url, index) => {
        records.push({
          id: `${report.id}:${category}:${index}`,
          category,
          categoryLabel,
          label: `${noun} ${index + 1}`,
          fileType: fileType(url),
          // Files in S3 open through the signed-in download route (owner check, short-lived link). A development
          // file in public/uploads opens directly. Anything else cannot be opened.
          href: url.startsWith("s3://")
            ? `/api/files/${report.id}/${offsets[category] + index}`
            : url.startsWith("/uploads/")
              ? url
              : null,
          uploadedOn: report.createdAt,
          reportId: report.id,
        });
      });
    }
  }
  return records;
}

function buildHistory(reports: DashboardReport[]): HistoryEntry[] {
  return reports.map((report, index) => {
    const durationMonths = report.plan?.durationMonths ?? null;
    let outcome: HistoryEntry["outcome"];
    let outcomeLabel: string;
    if (report.escalation) {
      outcome = "escalated";
      outcomeLabel = "Locked for in-person care";
    } else if (report.requiresInPersonCare) {
      outcome = "in_person_care";
      outcomeLabel = "Needs in-person care";
    } else if (report.plan) {
      const length = durationMonths ? ` (${pluralize(durationMonths, "month")})` : "";
      outcome = index === 0 ? "plan_active" : "plan_saved";
      outcomeLabel = index === 0 ? `Active plan${length}` : `Plan saved${length}`;
    } else {
      outcome = "in_progress";
      outcomeLabel = "Triage not finished";
    }
    return {
      reportId: report.id,
      createdAt: report.createdAt,
      title: report.conditionTitle,
      sourceLabel: isConditionSource(report.conditionSource) ? CONDITION_SOURCE_LABELS[report.conditionSource] : null,
      outcome,
      outcomeLabel,
      durationMonths,
      fileCount: report.scanUrls.length + report.prescriptionUrls.length + report.uncategorizedUrls.length,
      isLatest: index === 0,
    };
  });
}

function buildProgram(report: DashboardReport | null, todayKey: string, utcOffsetMinutes: number): DashboardModel["program"] {
  const empty = { durationMonths: null, month: null, phaseName: null, phaseTagline: null, dayNumber: null, startedOn: null };
  if (!report) return { state: "none", ...empty };
  if (report.escalation) return { state: "locked", ...empty };
  if (!report.plan) return { state: "intake", ...empty, startedOn: report.createdAt };

  const duration = report.plan.durationMonths;
  const startKey = report.plan.startDateKey ?? isoToDateKey(report.planCreatedAt ?? report.createdAt, utcOffsetMinutes);
  const elapsed = Math.max(0, daysBetween(startKey, todayKey));
  const month = Math.min(duration, Math.floor(elapsed / DAYS_PER_MONTH) + 1);
  const phase = report.plan.phases[month - 1];
  return {
    state: "active",
    durationMonths: duration,
    month,
    phaseName: phase?.phase ?? null,
    phaseTagline: phase?.tagline ?? null,
    dayNumber: elapsed + 1,
    startedOn: report.planCreatedAt ?? report.createdAt,
  };
}

function buildPrimaryAction(
  program: DashboardModel["program"],
  today: DashboardModel["today"],
): DashboardModel["primaryAction"] {
  switch (program.state) {
    case "none":
      return { href: "/workspace", label: "Start First Intake" };
    case "intake":
      return { href: "/workspace", label: "Finish Your Intake" };
    case "locked":
      return { href: "/workspace", label: "Review Safety Notice" };
    default:
      return {
        href: "/workspace",
        label: today.status === "completed" ? "Review Today's Session" : today.status === "rest" ? "Open Rehab Studio" : "Continue Today's Session",
      };
  }
}

export function buildDashboardModel(
  snapshot: DashboardSnapshot,
  todayKey: string,
  /** Date.getTimezoneOffset() of the viewer; 0 means UTC. */
  utcOffsetMinutes = 0,
): DashboardModel {
  const latest = activeReport(snapshot);
  // Bring the plan up to the calendar the same way the Rehab Studio does, so a
  // missed day shows here at once. Saving happens when the studio opens.
  const reconciled =
    latest?.plan && !latest.escalation
      ? reconcileSchedule(
          latest.plan,
          snapshot.progress,
          todayKey,
          isoToDateKey(latest.planCreatedAt ?? latest.createdAt, utcOffsetMinutes),
        )
      : null;
  const report = latest && reconciled ? { ...latest, plan: reconciled.plan } : latest;
  const notice = activeSkipNotice(report?.plan);
  const program = buildProgram(report, todayKey, utcOffsetMinutes);
  const today = buildToday(report, snapshot.progress, todayKey);

  const condition =
    report?.conditionTitle && report.conditionSummary && isConditionSource(report.conditionSource)
      ? {
          title: report.conditionTitle,
          summary: report.conditionSummary,
          source: report.conditionSource,
          requiresInPersonCare: report.requiresInPersonCare,
          careReason: report.careReason,
        }
      : null;

  return {
    firstName: snapshot.user.name.trim().split(/\s+/)[0] || "there",
    hasAnyIntake: snapshot.reports.length > 0,
    program,
    skipNotice: notice ? describeSkipNotice(notice) : null,
    primaryAction: buildPrimaryAction(program, today),
    condition,
    escalation: report?.escalation ?? null,
    evidence: report
      ? {
          scans: report.scanUrls.length,
          prescriptions: report.prescriptionUrls.length,
          other: report.uncategorizedUrls.length,
          symptoms: report.primarySymptoms.trim().length > 0,
        }
      : null,
    regions: report ? planRegions(report) : [],
    today,
    week: buildWeek(report, today, todayKey),
    adherence: buildAdherence(report, snapshot, todayKey, utcOffsetMinutes),
    trend: buildTrend(snapshot),
    guardrail: buildGuardrail(report, snapshot, todayKey),
    records: buildRecords(snapshot.reports),
    history: buildHistory(snapshot.reports),
  };
}
