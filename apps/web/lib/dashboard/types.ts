import type { Escalation } from "@/lib/clinical/assessment";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";

/**
 * What the dashboard reads from the database, as plain serializable values.
 * Dates are ISO strings; day keys are the local YYYY-MM-DD strings the
 * workspace already writes to DailyProgress and PainEvent.
 */

export type DashboardReport = {
  id: string;
  createdAt: string;
  primarySymptoms: string;
  scanUrls: string[];
  prescriptionUrls: string[];
  /** Files from reports made before uploads were split into two categories. */
  uncategorizedUrls: string[];
  conditionTitle: string | null;
  conditionSummary: string | null;
  conditionSource: string | null;
  requiresInPersonCare: boolean;
  careReason: string | null;
  escalation: Escalation | null;
  /** The saved routine, or null while triage is still in progress. */
  plan: StoredTreatmentPlan | null;
  planCreatedAt: string | null;
  hasQuiz: boolean;
};

export type DashboardProgressRow = {
  dateKey: string;
  completedExercises: string[];
  completed: boolean;
  feedback: "relief" | "same" | "issue" | null;
  stopped: boolean;
};

export type DashboardPainEvent = {
  dateKey: string;
  painType: string;
  regions: string[];
  exerciseNames: string[];
};

export type DashboardSnapshot = {
  user: { name: string; email: string; role: string };
  /** Newest first. */
  reports: DashboardReport[];
  /** Session logs and Pain Override reports for the newest report only. */
  progress: DashboardProgressRow[];
  painEvents: DashboardPainEvent[];
};

export type ProgramState = "none" | "intake" | "active" | "locked";

export type TodayExercise = {
  name: string;
  /** For example "1 set of 10 reps". Null when the exercise has no movement data. */
  dose: string | null;
  /** For example "2s up, 3s hold, 2s down". */
  pacing: string | null;
  durationSeconds: number;
  done: boolean;
};

export type TodayStatus = "none" | "locked" | "rest" | "pending" | "partial" | "completed" | "stopped";

export type WeekDayState = "completed" | "stopped" | "today" | "upcoming" | "rest";

export type WeekDay = {
  dateKey: string;
  weekday: string;
  dayOfMonth: number;
  state: WeekDayState;
  focus: string;
  isToday: boolean;
};

export type RecentDayState = "completed" | "stopped" | "none";

export type TrendPoint = {
  dateKey: string;
  /** 1 more relief, 0 about the same, -1 more discomfort. */
  level: -1 | 0 | 1;
  feedback: "relief" | "same" | "issue";
  stopped: boolean;
};

export type GuardrailState = "standard" | "hold" | "escalated";

export type GuardrailMeter = { label: string; value: number; limit: number };

export type RecordCategory = "scan" | "prescription" | "other";

export type PatientRecord = {
  id: string;
  category: RecordCategory;
  categoryLabel: string;
  /** "Scan 1", "Clinician note 2"; the original file name is not stored. */
  label: string;
  fileType: string;
  /** Link to open the file, only for files this server stores itself. */
  href: string | null;
  uploadedOn: string;
  reportId: string;
};

export type HistoryOutcome = "in_progress" | "plan_active" | "plan_saved" | "in_person_care" | "escalated";

export type HistoryEntry = {
  reportId: string;
  createdAt: string;
  title: string | null;
  sourceLabel: string | null;
  outcome: HistoryOutcome;
  outcomeLabel: string;
  durationMonths: number | null;
  fileCount: number;
  isLatest: boolean;
};

export type DashboardModel = {
  firstName: string;
  hasAnyIntake: boolean;
  program: {
    state: ProgramState;
    durationMonths: number | null;
    month: number | null;
    phaseName: string | null;
    phaseTagline: string | null;
    dayNumber: number | null;
    startedOn: string | null;
  };
  /** Set when working days passed with no exercise done and the plan moved forward. */
  skipNotice: { title: string; body: string } | null;
  primaryAction: { href: string; label: string };
  condition: {
    title: string;
    summary: string;
    source: import("@/lib/clinical/assessment").ConditionSource;
    requiresInPersonCare: boolean;
    careReason: string | null;
  } | null;
  escalation: Escalation | null;
  evidence: { scans: number; prescriptions: number; other: number; symptoms: boolean } | null;
  regions: string[];
  today: {
    dateKey: string;
    status: TodayStatus;
    focus: string | null;
    tagline: string | null;
    exercises: TodayExercise[];
    completedCount: number;
    feedback: "relief" | "same" | "issue" | null;
  };
  week: WeekDay[];
  adherence: {
    completedSessions: number;
    stoppedSessions: number;
    currentStreak: number;
    bestStreak: number;
    daysSinceStart: number | null;
    recent: { dateKey: string; state: RecentDayState }[];
    recentCompleted: number;
  };
  trend: {
    points: TrendPoint[];
    counts: { relief: number; same: number; issue: number; stops: number };
  };
  guardrail: {
    state: GuardrailState;
    title: string;
    detail: string;
    meters: GuardrailMeter[];
    evidence: string[];
  };
  records: PatientRecord[];
  history: HistoryEntry[];
};
