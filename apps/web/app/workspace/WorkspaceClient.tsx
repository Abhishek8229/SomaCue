"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { completeTriageQuiz } from "@/actions/intake";
import {
  resetDailyProgress,
  submitDailyFeedback,
  toggleExerciseCompletion,
} from "@/actions/dailyProgress";
import { reportPainEvent, reschedulePainEvent } from "@/actions/painEvent";
import { StageV2 } from "@/components/stage/StageV2";
import { StopReportForm, type StopReportSubmission } from "@/components/stage/StopReportForm";
import { useRepCelebration } from "@/components/stage/useRepCelebration";
import { speechEnabled, useStageController } from "@/components/stage/useStageController";
import { AnalysisProgress } from "@/components/workspace/AnalysisProgress";
import { ConditionCard } from "@/components/workspace/ConditionCard";
import { EscalationAlert } from "@/components/workspace/EscalationAlert";
import { RehabChatDrawer } from "@/components/workspace/RehabChatDrawer";
import { quickPrompts } from "@/lib/clinical/chatGuardrails";
import { DailyPrescriptionPanel } from "@/components/workspace/DailyPrescriptionPanel";
import { FeedbackModal } from "@/components/workspace/FeedbackModal";
import { SetRepCounter } from "@/components/workspace/SetRepCounter";
import { primeCelebrationAudio } from "@/lib/audio/celebrationSound";
import {
  buildSynthesisCopy,
  buildTriageCopy,
  type AnalysisCopy,
  type IntakeSnapshot,
} from "@/lib/analysis/progressCopy";
import type { DetectedCondition, Escalation } from "@/lib/clinical/assessment";
import { resolveStageExercise } from "@/lib/kinematics/exercise";
import { repProgress } from "@/lib/kinematics/progress";
import { REGIONS, type Region } from "@/lib/kinematics/vocabulary";
import {
  getDayExercises,
  toDateKey,
  type DailyProgressRecord,
  type FeedbackSubmission,
} from "@/lib/progress/dailyProgress";
import type { PainContext } from "@/lib/progress/painEvent";
import { usePrefersReducedMotion } from "@/lib/use-environment";
import {
  QuizModal,
  SidebarIntake,
  type FlowPhase,
  type InitialQuiz,
  type TreatmentPlanPayload,
  type TriageReadyResult,
  type TreatmentScheduleDay,
} from "./WorkspaceParts";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

type JourneyMonth = {
  key: string;
  name: string;
  fullName: string;
  year: number;
  phase: string;
  tagline: string;
};

type RollingDay = TreatmentScheduleDay & {
  key: string;
  day: string;
  date: string;
  month: string;
  year: number;
};

function createFallbackSchedule(plan: TreatmentPlanPayload): TreatmentScheduleDay[] {
  const phase = plan.phases[0];
  return Array.from({ length: 7 }, (_, dayOffset) => ({
    dayOffset,
    status: dayOffset === 0 ? "active" : dayOffset > 4 ? "rest" : "upcoming",
    focus: dayOffset > 4 ? "Recovery" : phase?.phase ?? "Baseline",
    tagline:
      dayOffset > 4
        ? "Pause and let your body recover."
        : phase?.tagline ?? "Follow your gentle baseline plan.",
  }));
}

function createRollingDays(plan: TreatmentPlanPayload | null): RollingDay[] {
  if (!plan) {
    return [];
  }

  const schedule = [...(plan.schedule?.days ?? createFallbackSchedule(plan))].sort(
    (left, right) => left.dayOffset - right.dayOffset,
  );
  const start = new Date();

  return schedule.map((scheduledDay) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + scheduledDay.dayOffset);
    return {
      ...scheduledDay,
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      day: date.toLocaleString("en-US", { weekday: "short" }),
      date: String(date.getDate()),
      month: date.toLocaleString("en-US", { month: "long" }),
      year: date.getFullYear(),
    };
  });
}

function createJourneyMonths(plan: TreatmentPlanPayload | null): JourneyMonth[] {
  if (!plan) {
    return [];
  }

  const start = new Date();
  return plan.phases.map((phase, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      name: date.toLocaleString("en-US", { month: "short" }),
      fullName: date.toLocaleString("en-US", { month: "long" }),
      year: date.getFullYear(),
      phase: phase.phase,
      tagline: phase.tagline,
    };
  });
}

function formatPlanDuration(durationMonths: number) {
  return `${durationMonths} ${durationMonths === 1 ? "month" : "months"}`;
}

function getCalendarCells(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const mondayFirstOffset = (firstDay.getDay() + 6) % 7;

  return [
    ...Array.from({ length: mondayFirstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

/** Converts a calendar key ("year-monthIndex-day") into a Date at local midnight. */
function parseCalendarKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month, day);
}

const isRegion = (value: string): value is Region => (REGIONS as readonly string[]).includes(value);

type PainFlow = {
  /** the form is open */
  open: boolean;
  submitting: boolean;
  error: string | null;
  context: PainContext;
  exercise: string | null;
  regions: Region[];
  eventId: string | null;
  reschedule: "idle" | "pending" | "done" | "failed";
};

export default function WorkspacePage({
  hasActivePlan,
  initialCondition = null,
  initialEscalation = null,
  initialIntake = null,
  initialProgress = [],
  initialQuiz,
  reportId,
  routine,
  userName,
}: {
  userName?: string;
  hasActivePlan: boolean;
  initialCondition?: DetectedCondition | null;
  initialEscalation?: Escalation | null;
  initialIntake?: IntakeSnapshot | null;
  initialProgress?: DailyProgressRecord[];
  initialQuiz: InitialQuiz | null;
  reportId: string | null;
  routine: TreatmentPlanPayload | null;
}) {
  const [selectedDayOffset, setSelectedDayOffset] = useState(0);
  const currentMonth = new Date();
  const [calendarMonth, setCalendarMonth] = useState(
    new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1),
  );
  const [selectedMonth, setSelectedMonth] = useState(
    `${currentMonth.getFullYear()}-${currentMonth.getMonth()}`,
  );
  const [isListening, setIsListening] = useState(false);
  const [reportsSubmitted, setReportsSubmitted] = useState(
    hasActivePlan || initialQuiz !== null || initialEscalation !== null,
  );
  const [condition, setCondition] = useState(initialCondition);
  /** Locks the whole platform until the patient starts a new intake. */
  const [escalation, setEscalation] = useState(initialEscalation);
  const [arrivalMessage, setArrivalMessage] = useState<string | null>(null);
  const [intakeSnapshot, setIntakeSnapshot] = useState(initialIntake);
  const [analysisCopy, setAnalysisCopy] = useState<AnalysisCopy | null>(null);
  /** Applies the AI result once the progress ring has reached 100%. */
  const [pendingArrival, setPendingArrival] = useState<(() => void) | null>(null);
  const [planUnlocked, setPlanUnlocked] = useState(hasActivePlan);
  const [treatmentPlan, setTreatmentPlan] = useState(routine);
  const [triageQuiz, setTriageQuiz] = useState(initialQuiz);
  const [activeReportId, setActiveReportId] = useState(reportId);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [flowPhase, setFlowPhase] = useState<FlowPhase>(
    hasActivePlan || initialEscalation ? "ready" : initialQuiz ? "quiz" : "discovery",
  );
  const [flowError, setFlowError] = useState<string | null>(null);
  const [progressByDate, setProgressByDate] = useState<Record<string, DailyProgressRecord>>(
    () => Object.fromEntries(initialProgress.map((record) => [record.dateKey, record])),
  );
  const [pendingExercise, setPendingExercise] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [painFlow, setPainFlow] = useState<PainFlow | null>(null);

  const journeyMonths = useMemo(
    () => createJourneyMonths(treatmentPlan),
    [treatmentPlan],
  );
  const rollingDays = useMemo(() => createRollingDays(treatmentPlan), [treatmentPlan]);
  const scheduleStartDate = useMemo(() => {
    const firstScheduledDay = rollingDays[0];
    if (firstScheduledDay) {
      const [year, month, day] = firstScheduledDay.key.split("-").map(Number);
      return new Date(year, month, day);
    }

    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }, [rollingDays]);
  const scheduleEndDate = useMemo(() => {
    const lastScheduledDay = rollingDays.at(-1);
    if (lastScheduledDay) {
      const [year, month, day] = lastScheduledDay.key.split("-").map(Number);
      return new Date(year, month, day);
    }

    return scheduleStartDate;
  }, [rollingDays, scheduleStartDate]);
  const calendarCells = useMemo(() => getCalendarCells(calendarMonth), [calendarMonth]);
  const calendarMonthLabel = calendarMonth.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  const activeJourneyMonth =
    journeyMonths.find((month) => month.key === selectedMonth) ?? journeyMonths[0];
  const selectedScheduleDay = rollingDays.find(
    (day) => day.dayOffset === selectedDayOffset && day.key.startsWith(`${selectedMonth}-`),
  );
  const selectedCareDay =
    selectedScheduleDay ??
    (activeJourneyMonth
      ? {
          dayOffset: 0,
          status: "upcoming" as const,
          focus: activeJourneyMonth.phase,
          tagline: activeJourneyMonth.tagline,
          key: "no-scheduled-day",
          day: activeJourneyMonth.name,
          date: "",
          month: activeJourneyMonth.fullName,
          year: activeJourneyMonth.year,
        }
      : null) ?? {
      dayOffset: 0,
      status: "active" as const,
      focus: "Baseline",
      tagline: "Your plan will appear after triage.",
      key: "today",
      day: new Date().toLocaleString("en-US", { weekday: "short" }),
      date: String(new Date().getDate()),
      month: new Date().toLocaleString("en-US", { month: "long" }),
      year: new Date().getFullYear(),
    };
  const selectedDateKey = selectedScheduleDay
    ? toDateKey(parseCalendarKey(selectedScheduleDay.key))
    : null;
  const canRecordProgress = selectedDateKey !== null && selectedDateKey === toDateKey(new Date());
  const selectedProgress = selectedDateKey ? progressByDate[selectedDateKey] : undefined;
  const selectedExercises = useMemo(
    () => (treatmentPlan ? getDayExercises(treatmentPlan, selectedScheduleDay) : []),
    [treatmentPlan, selectedScheduleDay],
  );
  const stageExercises = useMemo(() => selectedExercises.map(resolveStageExercise), [selectedExercises]);
  const todayKey = toDateKey(new Date());
  const todayProgress = progressByDate[todayKey];
  const stoppedToday = todayProgress?.stopped === true;
  const stage = useStageController(stageExercises.length, stoppedToday);
  const stageKey = `${selectedCareDay.key}|${stageExercises.map((exercise) => exercise.name).join("|")}`;
  const [loadedStageKey, setLoadedStageKey] = useState(stageKey);
  if (loadedStageKey !== stageKey) {
    // A different day or plan: start again from the first exercise.
    setLoadedStageKey(stageKey);
    stage.dispatch({ type: "load", count: stageExercises.length });
  }
  const sessionStopped = stage.state.stopped || stoppedToday;
  const stageState = sessionStopped === stage.state.stopped ? stage.state : { ...stage.state, stopped: sessionStopped };
  const currentStageExercise = stageExercises[stage.state.index] ?? null;
  const currentSpec = currentStageExercise?.spec ?? null;
  const reducedMotion = usePrefersReducedMotion();
  const { celebration } = useRepCelebration({
    spec: currentSpec,
    hud: stage.state.hud,
    playing: stage.state.playing,
    stopped: sessionStopped,
    resetKey: `${stage.state.index}-${stage.state.restartKey}`,
  });
  const voiceActive = speechEnabled(stage.state);
  const realtimePace = stage.state.pace === "realtime";
  const painRegions = useMemo<Region[]>(
    () => painFlow?.regions ?? (todayProgress?.stopRegions ?? []).filter(isRegion),
    [painFlow, todayProgress],
  );
  const flaggedRegions = useMemo(() => {
    // Regions from stop reports on earlier days, shown as calm amber rings.
    const regions = new Set<Region>();
    for (const record of Object.values(progressByDate)) {
      if (record.dateKey === todayKey || !record.stopped) continue;
      for (const region of record.stopRegions ?? []) if (isRegion(region)) regions.add(region);
    }
    return [...regions];
  }, [progressByDate, todayKey]);
  const stageGlow = useMemo(() => ({ pain: painRegions, flagged: flaggedRegions }), [painRegions, flaggedRegions]);
  const syncCalendarMonth = (nextMonth: Date) => {
    setScheduleNotice(null);
    setCalendarMonth(nextMonth);
    const nextMonthKey = getMonthKey(nextMonth);
    const nextJourneyMonth = journeyMonths.find((month) => month.key === nextMonthKey);
    if (nextJourneyMonth) {
      setSelectedMonth(nextJourneyMonth.key);
    }

    const nextCareDay = rollingDays.find((day) => day.key.startsWith(`${nextMonthKey}-`));
    setSelectedDayOffset(nextCareDay?.dayOffset ?? 0);
  };
  const isFlowLocked =
    flowPhase === "preparing" || flowPhase === "quiz" || flowPhase === "finalizing";

  const activeJourneyMonthKey = journeyMonths.some((month) => month.key === selectedMonth)
    ? selectedMonth
    : journeyMonths[0]?.key;

  const handlePreparing = (intake: IntakeSnapshot) => {
    setIntakeSnapshot(intake);
    setAnalysisCopy(buildTriageCopy(intake));
    setPendingArrival(null);
    setArrivalMessage(null);
    setFlowError(null);
    setFlowPhase("preparing");
  };

  const handleTriageReady = (result: TriageReadyResult) => {
    const quizId = result.quizId;
    setArrivalMessage(result.escalation || !quizId ? "Your assessment is ready." : null);
    setPendingArrival(() => () => {
      setCondition(result.condition);
      setActiveReportId(result.reportId);
      setReportsSubmitted(true);
      if (result.escalation || !quizId) {
        setPlanUnlocked(false);
        setFlowPhase("ready");
        if (result.escalation) setEscalation(result.escalation);
        return;
      }
      setTriageQuiz({
        id: quizId,
        reportId: result.reportId,
        questions: result.questions,
      });
      setActiveReportId(result.reportId);
      setQuizAnswers({});
      setReportsSubmitted(true);
      setPlanUnlocked(false);
      setFlowPhase("quiz");
    });
  };

  const handleAnalysisComplete = () => {
    pendingArrival?.();
    setPendingArrival(null);
  };

  const handleRerunAnalysis = () => {
    setEscalation(null);
    setCondition(null);
    setReportsSubmitted(false);
    setPlanUnlocked(false);
    setTreatmentPlan(null);
    setTriageQuiz(null);
    setActiveReportId(null);
    setQuizAnswers({});
    setProgressByDate({});
    setIsFeedbackOpen(false);
    setPainFlow(null);
    stage.dispatch({ type: "resume" });
    setFlowError(null);
    setFlowPhase("discovery");
  };

  const updateProgress = (dateKey: string, patch: Partial<DailyProgressRecord>) =>
    setProgressByDate((current) => {
      const base: DailyProgressRecord = current[dateKey] ?? {
        dateKey,
        completedExercises: [],
        completed: false,
        feedback: null,
      };
      return { ...current, [dateKey]: { ...base, ...patch } };
    });

  const handleToggleExercise = async (exerciseName: string, checked: boolean) => {
    if (!activeReportId || !selectedDateKey) {
      return;
    }

    const dateKey = selectedDateKey;
    const previous = progressByDate[dateKey]?.completedExercises ?? [];
    setProgressError(null);
    setPendingExercise(exerciseName);
    updateProgress(dateKey, {
      completedExercises: checked
        ? [...new Set([...previous, exerciseName])]
        : previous.filter((name) => name !== exerciseName),
    });

    try {
      const result = await toggleExerciseCompletion(
        activeReportId,
        dateKey,
        exerciseName,
        checked,
      );
      if (result.success) {
        updateProgress(dateKey, { completedExercises: result.completedExercises });
      } else {
        updateProgress(dateKey, { completedExercises: previous });
        setProgressError(result.error);
      }
    } catch {
      updateProgress(dateKey, { completedExercises: previous });
      setProgressError("Your progress could not be saved. Please try again.");
    } finally {
      setPendingExercise(null);
    }
  };

  const handleResetDay = async () => {
    if (!activeReportId || !selectedDateKey) {
      return;
    }

    const dateKey = selectedDateKey;
    setProgressError(null);
    setIsResetting(true);
    try {
      const result = await resetDailyProgress(activeReportId, dateKey);
      if (result.success) {
        updateProgress(dateKey, {
          completedExercises: [],
          completed: false,
          feedback: null,
          stopped: false,
          stopRegions: [],
        });
        setFeedbackError(null);
        if (dateKey === todayKey) {
          setPainFlow(null);
          stage.dispatch({ type: "resume" });
        }
        if (result.schedule !== undefined) {
          const restoredSchedule = result.schedule ?? undefined;
          setTreatmentPlan((plan) => (plan ? { ...plan, schedule: restoredSchedule } : plan));
        }
      } else {
        setProgressError(result.error);
      }
    } catch {
      setProgressError("Today's progress could not be reset. Please try again.");
    } finally {
      setIsResetting(false);
    }
  };

  const openFeedback = () => {
    setFeedbackError(null);
    setIsFeedbackOpen(true);
  };

  /** The case is beyond online rehab: stop everything and show the lockout. */
  const lockForInPersonCare = (next: Escalation) => {
    stage.dispatch({ type: "pause" });
    setIsFeedbackOpen(false);
    setPainFlow((flow) => (flow ? { ...flow, open: false, submitting: false } : flow));
    setEscalation(next);
  };

  /** Red-flag stop: abort immediately, rest the figure, glow the area, open the report. */
  const handlePainOverride = () => {
    const exercise = currentStageExercise;
    const hud = stage.state.hud;
    stage.dispatch({ type: "stop" });
    setIsFeedbackOpen(false);
    setPainFlow({
      open: true,
      submitting: false,
      error: null,
      exercise: exercise?.name ?? null,
      regions: exercise?.spec?.targetRegions ?? [],
      eventId: null,
      reschedule: "idle",
      context: {
        exerciseName: exercise?.name ?? null,
        rep: hud?.rep ?? null,
        set: hud?.set ?? null,
        phase: hud?.phase ?? null,
        elapsedSeconds: hud ? Math.round(hud.elapsed * 10) / 10 : null,
      },
    });
  };

  const runPainReschedule = async (eventId: string) => {
    if (!activeReportId) return;
    setPainFlow((flow) => (flow ? { ...flow, reschedule: "pending" } : flow));
    try {
      const result = await reschedulePainEvent(activeReportId, eventId);
      if (result.success) {
        setTreatmentPlan((plan) => (plan ? { ...plan, schedule: result.schedule } : plan));
        setPainFlow((flow) => (flow ? { ...flow, reschedule: "done" } : flow));
      } else {
        setPainFlow((flow) => (flow ? { ...flow, reschedule: "failed" } : flow));
      }
    } catch {
      setPainFlow((flow) => (flow ? { ...flow, reschedule: "failed" } : flow));
    }
  };

  const handleSubmitStopReport = async (submission: StopReportSubmission) => {
    if (!painFlow) return;
    if (!activeReportId) {
      setPainFlow({ ...painFlow, error: "Your plan could not be found. Reload the page and try again." });
      return;
    }
    setPainFlow({ ...painFlow, submitting: true, error: null });
    try {
      const result = await reportPainEvent(activeReportId, todayKey, {
        ...submission,
        context: painFlow.context,
      });
      if (!result.success) {
        setPainFlow((flow) => (flow ? { ...flow, submitting: false, error: result.error } : flow));
        return;
      }
      updateProgress(todayKey, { stopped: true, stopRegions: submission.regions });
      setPainFlow((flow) =>
        flow
          ? { ...flow, open: false, submitting: false, regions: submission.regions, eventId: result.eventId }
          : flow,
      );
      if (result.escalation) {
        lockForInPersonCare(result.escalation);
        return;
      }
      void runPainReschedule(result.eventId);
    } catch {
      setPainFlow((flow) =>
        flow ? { ...flow, submitting: false, error: "Your report could not be saved. Please try again." } : flow,
      );
    }
  };

  const stopMessage = !sessionStopped
    ? null
    : painFlow?.reschedule === "pending"
      ? "Report saved. Updating your plan to avoid this movement…"
      : painFlow?.reschedule === "done"
        ? "Report saved. Your plan from tomorrow avoids this movement."
        : painFlow?.reschedule === "failed"
          ? "Report saved, but the plan could not be updated yet."
          : stoppedToday
            ? "Report saved."
            : "Tell us what happened so your plan can change.";

  const handleSubmitFeedback = async (submission: FeedbackSubmission) => {
    if (!activeReportId || !selectedDateKey) {
      return;
    }

    const dateKey = selectedDateKey;
    setFeedbackError(null);
    setFeedbackSubmitting(true);
    try {
      const result = await submitDailyFeedback(activeReportId, dateKey, submission);
      if (!result.success) {
        setFeedbackError(result.error);
        return;
      }

      // The day is saved as completed even when the schedule update fails.
      updateProgress(dateKey, { completed: true, feedback: submission.feedback });
      if (!result.rescheduled && result.escalation) {
        lockForInPersonCare(result.escalation);
      } else if (result.rescheduled) {
        setTreatmentPlan((plan) => (plan ? { ...plan, schedule: result.schedule } : plan));
        setIsFeedbackOpen(false);
      } else if (result.rescheduleError) {
        setFeedbackError(
          result.rescheduleError === "AI_PROVIDER_TIMEOUT"
            ? "Your feedback was saved, but the schedule update timed out. Try again."
            : "Your feedback was saved, but the schedule could not be updated. Try again.",
        );
      } else {
        setIsFeedbackOpen(false);
      }
    } catch {
      setFeedbackError("Your feedback could not be saved. Please try again.");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleCompleteQuiz = async () => {
    if (!triageQuiz) {
      return;
    }

    setFlowError(null);
    setAnalysisCopy(
      buildSynthesisCopy(
        intakeSnapshot,
        triageQuiz.questions.map((question) => ({
          question: question.question,
          answer: quizAnswers[question.id] ?? "",
          multipleChoice: question.answerType === "multiple_choice",
        })),
      ),
    );
    setPendingArrival(null);
    setArrivalMessage(null);
    setFlowPhase("finalizing");

    try {
      const result = await completeTriageQuiz(
        triageQuiz.reportId,
        triageQuiz.id,
        quizAnswers,
      );
      if (!("error" in result)) {
        const { escalation: found, routine: plan } = result;
        setArrivalMessage(found ? "Your assessment is ready." : null);
        setPendingArrival(() => () => {
          if (found || !plan) {
            setPlanUnlocked(false);
            setFlowPhase("ready");
            if (found) setEscalation(found);
            return;
          }
          setTreatmentPlan(plan);
          setPlanUnlocked(true);
          setFlowPhase("ready");
        });
      } else {
        setFlowPhase("quiz");
        setFlowError(
          result.error === "AI_PROVIDER_TIMEOUT"
            ? "The AI provider timed out. Please try again."
            : "The AI provider is unavailable. Please try again later.",
        );
      }
    } catch (error) {
      setFlowPhase("quiz");
      setFlowError(error instanceof Error ? error.message : "Unable to complete the triage.");
    }
  };

  const chatPrompts = quickPrompts({
    hasCondition: condition !== null,
    hasPlan: planUnlocked && treatmentPlan !== null,
    exerciseCount: getDayExercises(treatmentPlan ?? { steps: [] }, rollingDays.find((day) => day.dayOffset === 0)).length,
    escalated: escalation !== null,
    stoppedToday,
  });

  const quizComplete =
    triageQuiz !== null &&
    triageQuiz.questions.every((question) => (quizAnswers[question.id] ?? "").trim().length > 0);

  return (
    <main
      aria-busy={isFlowLocked}
      className="workspace-shell relative flex h-[calc(100dvh-var(--nav-h))] flex-col overflow-hidden bg-zinc-950 text-white"
    >
      <header className="workspace-header flex h-16 shrink-0 items-center justify-between border-b border-white/15 bg-zinc-900 px-5">
        <div className="flex min-w-[220px] items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-300/50 bg-emerald-300/10 text-lg font-semibold text-emerald-200">
            S
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">SomaCue</p>
            <p className="max-w-[180px] truncate text-[10px] text-white/60">
              Rehab Studio{userName ? ` / ${userName}` : ""}
            </p>
          </div>
        </div>

        {planUnlocked ? (
          <nav
            className="flex min-w-0 flex-1 justify-center gap-1 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Long-term care journey"
          >
            {journeyMonths.map((month) => (
              <button
                className={`${interactive} flex min-w-[104px] max-w-[132px] shrink-0 flex-col items-center rounded-lg px-2 py-1 ${
                  activeJourneyMonthKey === month.key
                    ? "bg-emerald-300 text-black"
                    : "text-white/65 hover:bg-white/10 hover:text-white"
                }`}
                key={month.key}
                onClick={() => {
                  setSelectedMonth(month.key);
                  setScheduleNotice(null);
                  setCalendarMonth(new Date(month.year, Number(month.key.split("-")[1]), 1));
                  setSelectedDayOffset(
                    rollingDays.find((day) => day.key.startsWith(`${month.key}-`))?.dayOffset ?? 0,
                  );
                }}
                type="button"
              >
                <span className="text-[9px] font-medium">{month.name}</span>
                <span
                  className="mt-0.5 w-full whitespace-normal text-center text-[9px] leading-3"
                  title={`${month.phase}: ${month.tagline}`}
                >
                  {month.tagline}
                </span>
              </button>
            ))}
          </nav>
        ) : null}

        <div className="flex min-w-[220px] items-center justify-end gap-4">
          {planUnlocked && treatmentPlan ? (
            <span className="rounded-lg border border-white/15 bg-zinc-950 px-2 py-1 text-[10px] text-white/70">
              {formatPlanDuration(treatmentPlan.durationMonths)} plan
            </span>
          ) : null}
          <Link className={`${interactive} text-[11px] text-white/65 hover:text-white`} href="/dashboard#history">
            Patient History
          </Link>
          <span className="hidden items-center gap-2 text-[10px] text-emerald-300 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Progress Saved
          </span>
        </div>
      </header>

      <div className="workspace-grid flex-1 grid grid-cols-12 gap-4 overflow-hidden p-4">
        <div className="workspace-rail col-span-3 flex flex-col gap-4 overflow-y-auto">
          <SidebarIntake
            flowError={flowError}
            flowPhase={flowPhase}
            onError={(message) => {
              setFlowError(message);
              setFlowPhase("discovery");
            }}
            onPreparing={handlePreparing}
            onRerunAnalysis={handleRerunAnalysis}
            onTriageReady={handleTriageReady}
            reportsSubmitted={reportsSubmitted}
            summary={condition ? <ConditionCard condition={condition} escalation={escalation} /> : null}
          />
          {!isFlowLocked ? (
            <RehabChatDrawer key={activeReportId ?? "no-report"} quickPrompts={chatPrompts} reportId={activeReportId} />
          ) : null}
        </div>

        <StageV2
          dayLabel={`${selectedCareDay.day} ${selectedCareDay.date}`.trim()}
          dispatch={stage.dispatch}
          exercises={stageExercises}
          glow={stageGlow}
          planUnlocked={planUnlocked}
          reportsSubmitted={reportsSubmitted}
          state={stageState}
        />

        {planUnlocked ? (
          <div className="workspace-rail workspace-right-rail col-span-3 flex flex-col gap-4 overflow-y-auto">
            <section className="workspace-panel workspace-calendar rounded-2xl border border-white/15 bg-zinc-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-medium text-emerald-300">Daily schedule</p>
                  <h2 className="mt-1 text-sm font-medium tracking-tight">
                    {calendarMonthLabel}
                  </h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    aria-label="Previous month"
                    className={`${interactive} workspace-calendar-nav grid h-7 w-7 place-items-center rounded-md text-sm font-semibold`}
                    onClick={() =>
                      syncCalendarMonth(
                        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1),
                      )
                    }
                    type="button"
                  >
                    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
                      <path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                    </svg>
                  </button>
                  <button
                    aria-label="Next month"
                    className={`${interactive} workspace-calendar-nav grid h-7 w-7 place-items-center rounded-md text-sm font-semibold`}
                    onClick={() =>
                      syncCalendarMonth(
                        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1),
                      )
                    }
                    type="button"
                  >
                    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
                      <path d="m9 18 6-6-6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="grid grid-cols-7 text-center text-[10px] font-semibold text-white/80">
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
                  {calendarCells.map((day, index) => {
                    if (day === null) {
                      return <span aria-hidden="true" key={`empty-${index}`} />;
                    }

                    const date = new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth(),
                      day,
                    );
                    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    const careDay = rollingDays.find((item) => item.key === dateKey);
                    const isDayDone = progressByDate[toDateKey(date)]?.completed === true;
                    const isDayStopped = progressByDate[toDateKey(date)]?.stopped === true;
                    const isSelected = selectedCareDay.key === dateKey;
                    const isToday =
                      date.toDateString() === new Date().toDateString();
                    const isBeforeScheduleStart = date < scheduleStartDate;
                    const isBeyondScheduleHorizon = date > scheduleEndDate;

                    return (
                      <button
                        aria-label={`${calendarMonthLabel} ${day}${isDayStopped ? ", session stopped" : isDayDone ? ", session completed" : ""}`}
                        className={`${interactive} relative mx-auto grid h-7 w-7 place-items-center rounded-md text-[11px] ${
                          isBeforeScheduleStart
                            ? "cursor-not-allowed text-white/20 blur-[1px]"
                            : isSelected
                            ? "workspace-calendar-selected font-semibold"
                            : isBeyondScheduleHorizon
                              ? "text-white/35 hover:bg-white/10 hover:text-white/70"
                            : isToday
                              ? "workspace-calendar-today font-semibold"
                              : "text-white/70 hover:bg-white/10 hover:text-white"
                        }`}
                        disabled={isBeforeScheduleStart}
                        key={dateKey}
                        onClick={() => {
                          if (isBeforeScheduleStart) {
                            return;
                          }

                          const clickedMonthKey = getMonthKey(date);
                          const clickedJourneyMonth = journeyMonths.find(
                            (month) => month.key === clickedMonthKey,
                          );
                          if (clickedJourneyMonth) {
                            setSelectedMonth(clickedJourneyMonth.key);
                          }
                          if (careDay) {
                            setScheduleNotice(null);
                            setSelectedDayOffset(careDay.dayOffset);
                          } else if (isBeyondScheduleHorizon) {
                            setScheduleNotice(
                              "Too soon to be here. We’ll update this part of the plan after your feedback and the next AI analysis.",
                            );
                          }
                        }}
                        type="button"
                      >
                        {day}
                        {isDayStopped ? (
                          <span aria-hidden="true" className="workspace-calendar-stopped" />
                        ) : isDayDone ? (
                          <span aria-hidden="true" className="workspace-calendar-done" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 text-[10px] text-white/55">
                {selectedCareDay.focus} · showing the rolling days available from your plan
              </p>
              <p className="mt-1 text-[9px] text-white/35">
                Schedule starts {scheduleStartDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}. Earlier dates are unavailable.
              </p>
              {scheduleNotice ? (
                <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-100">
                  {scheduleNotice}
                </p>
              ) : null}
            </section>

            {scheduleNotice ? (
              <section className="workspace-panel flex min-h-56 flex-col items-center justify-center rounded-2xl border border-amber-300/25 bg-zinc-900 p-6 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-full border border-amber-300/35 bg-amber-300/10 text-amber-200">
                  <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22">
                    <path d="M12 8v4m0 4h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.74 3h14.92a2 2 0 0 0 1.74-3L13.7 3.8a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
                  </svg>
                </div>
                <h2 className="mt-4 text-base font-medium tracking-tight">Too soon to be here</h2>
                <p className="mt-2 max-w-xs text-[11px] leading-relaxed text-white/60">
                  This date has not been analyzed yet. We’ll update the plan after your feedback and the next AI analysis.
                </p>
              </section>
            ) : (
            <DailyPrescriptionPanel
              canInteract={canRecordProgress}
              completedExercises={selectedProgress?.completedExercises ?? []}
              dayLabel={selectedCareDay.day}
              errorMessage={progressError}
              focus={selectedCareDay.focus}
              isDayCompleted={selectedProgress?.completed ?? false}
              isResetting={isResetting}
              isStopped={canRecordProgress && sessionStopped}
              onDone={openFeedback}
              onReportStop={
                canRecordProgress && sessionStopped && !stoppedToday && painFlow && !painFlow.open
                  ? () => setPainFlow((flow) => (flow ? { ...flow, open: true, error: null } : flow))
                  : painFlow?.reschedule === "failed" && painFlow.eventId
                    ? () => void runPainReschedule(painFlow.eventId as string)
                    : null
              }
              onReset={handleResetDay}
              stopActionLabel={
                painFlow?.reschedule === "failed" ? "Try updating the plan again" : "Report what happened"
              }
              stopMessage={canRecordProgress ? stopMessage : null}
              onToggleExercise={handleToggleExercise}
              pendingExercise={pendingExercise}
              status={selectedCareDay.status}
              steps={selectedExercises}
              tagline={selectedCareDay.tagline}
            />
            )}
          </div>
        ) : null}
      </div>

      {isFlowLocked ? (
        <div className="absolute inset-x-0 top-16 bottom-20 z-30 grid place-items-center bg-zinc-950/95 p-6">
          {flowPhase === "quiz" && triageQuiz ? (
            <QuizModal
              flowError={flowError}
              onAnswer={(questionId, answer) =>
                setQuizAnswers((answers) => ({ ...answers, [questionId]: answer }))
              }
              onComplete={handleCompleteQuiz}
              quizComplete={quizComplete}
              quizAnswers={quizAnswers}
              triageQuiz={triageQuiz}
            />
          ) : analysisCopy ? (
            <AnalysisProgress
              arrived={pendingArrival !== null}
              copy={analysisCopy}
              doneMessage={
                arrivalMessage ??
                (flowPhase === "preparing"
                  ? "Your follow-up questions are ready."
                  : "Your treatment plan is ready.")
              }
              eyebrow={flowPhase === "preparing" ? "Diagnostic triage" : "Treatment synthesis"}
              footnote={
                flowPhase === "preparing"
                  ? "Your follow-up questions will open here as soon as they are ready."
                  : "Your plan will open here as soon as it is ready."
              }
              key={flowPhase}
              onComplete={handleAnalysisComplete}
              timeConstant={flowPhase === "preparing" ? 30 : 38}
            />
          ) : null}
        </div>
      ) : null}

      {escalation && !isFlowLocked ? (
        <EscalationAlert condition={condition} escalation={escalation} onStartNewIntake={handleRerunAnalysis} />
      ) : null}

      {isFeedbackOpen ? (
        <FeedbackModal
          errorMessage={feedbackError}
          exercises={selectedExercises.map((step) => step.exerciseName)}
          isSubmitting={feedbackSubmitting}
          onClose={() => setIsFeedbackOpen(false)}
          onSubmit={handleSubmitFeedback}
        />
      ) : null}

      {painFlow?.open ? (
        <StopReportForm
          errorMessage={painFlow.error}
          exercises={stageExercises.map((exercise) => exercise.name)}
          initialExercise={painFlow.exercise}
          initialRegions={painFlow.regions}
          isSubmitting={painFlow.submitting}
          onClose={() => setPainFlow((flow) => (flow ? { ...flow, open: false } : flow))}
          onSubmit={handleSubmitStopReport}
        />
      ) : null}

      <footer className="flex h-20 shrink-0 items-center justify-between border-t border-white/15 bg-zinc-900 px-5">
        <div className="min-w-[220px]">
          <p className={`text-[10px] ${sessionStopped ? "text-red-300" : "text-emerald-300"}`}>
            {sessionStopped
              ? "Session stopped"
              : stageExercises.length
                ? `Exercise ${stage.state.index + 1} of ${stageExercises.length}`
                : "No session today"}
          </p>
          {currentSpec ? (
            <SetRepCounter
              celebration={celebration}
              progress={repProgress(currentSpec, stage.state.hud)}
              reducedMotion={reducedMotion}
              reps={currentSpec.reps}
              sets={currentSpec.sets}
            />
          ) : (
            <p className="mt-1 text-xs text-white/80">{currentStageExercise?.name ?? "Rest and recover"}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`${interactive} rounded-lg px-2 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!planUnlocked || sessionStopped || stage.state.index === 0}
            onClick={() => stage.dispatch({ type: "prev" })}
            type="button"
          >
            Prev
          </button>
          <button
            aria-label={stage.state.playing ? "Pause playback" : "Play playback"}
            className={`${interactive} grid h-10 w-10 place-items-center rounded-full bg-emerald-300 text-[10px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!planUnlocked || sessionStopped || !currentStageExercise?.spec}
            onClick={() => {
              primeCelebrationAudio();
              stage.dispatch({ type: "toggle" });
            }}
            type="button"
          >
            {stage.state.playing ? "Pause" : "Play"}
          </button>
          <button
            className={`${interactive} rounded-lg px-2 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!planUnlocked || sessionStopped || stage.state.index >= stageExercises.length - 1}
            onClick={() => stage.dispatch({ type: "next" })}
            type="button"
          >
            Next
          </button>
          <div aria-label="Playback speed" className="ml-3 flex rounded-lg border border-white/10 bg-black/25 p-1" role="group">
            {([0.5, 1] as const).map((speed) => (
              <button
                aria-pressed={stage.state.speed === speed}
                className={`${interactive} rounded px-2 py-1 font-mono text-[9px] ${
                  stage.state.speed === speed ? "bg-white/10 text-white" : "text-white/45 hover:text-white"
                }`}
                key={speed}
                onClick={() => stage.dispatch({ type: "speed", speed })}
                type="button"
              >
                {speed === 1 ? "1.0x" : "0.5x"}
              </button>
            ))}
          </div>
          <div aria-label="Pace" className="ml-3 flex rounded-lg border border-white/10 bg-black/25 p-1" role="group">
            {(
              [
                ["guided", "Guided", "Waits for each spoken instruction before moving"],
                ["realtime", "Real-time", "Moves continuously with no spoken instructions"],
              ] as const
            ).map(([pace, label, hint]) => (
              <button
                aria-pressed={stage.state.pace === pace}
                className={`${interactive} rounded px-2 py-1 text-[9px] ${
                  stage.state.pace === pace ? "bg-emerald-300/15 text-emerald-100" : "text-white/45 hover:text-white"
                }`}
                key={pace}
                onClick={() => stage.dispatch({ type: "pace", pace })}
                title={hint}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <button
            aria-label={
              realtimePace
                ? "Spoken instructions are off in Real-time pace"
                : voiceActive
                  ? "Mute spoken instructions"
                  : "Turn on spoken instructions"
            }
            aria-pressed={voiceActive}
            className={`${interactive} grid h-8 w-8 place-items-center rounded-lg border disabled:cursor-not-allowed disabled:opacity-35 ${
              voiceActive
                ? "border-emerald-300/40 text-emerald-200 hover:bg-emerald-300/10"
                : "border-white/15 text-white/45 hover:text-white"
            }`}
            disabled={realtimePace}
            onClick={() => stage.dispatch({ type: "voice", on: !stage.state.voiceOn })}
            title={realtimePace ? "Spoken instructions are off in Real-time pace" : voiceActive ? "Voice on" : "Voice muted"}
            type="button"
          >
            {voiceActive ? <Volume2 aria-hidden="true" size={14} /> : <VolumeX aria-hidden="true" size={14} />}
          </button>
          <button className={`${interactive} ml-3 flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-[10px] text-white/65 hover:border-emerald-300/50 hover:text-emerald-300`} onClick={() => setIsListening((value) => !value)} type="button">
            <span className={isListening ? "text-emerald-300" : "text-white/55"}>●</span>
            {isListening ? "Listening" : "Voice feedback"}
          </button>
        </div>
        <button
          aria-describedby="pain-override-hint"
          className={`${interactive} flex min-w-[155px] items-center gap-3 whitespace-nowrap rounded-xl border border-red-400/60 bg-red-400/10 px-3 py-2 text-left text-red-100 hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={!planUnlocked || sessionStopped}
          onClick={handlePainOverride}
          type="button"
        >
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-red-400/70 font-mono text-sm text-red-400">!</span>
          <span className="flex flex-col whitespace-nowrap">
            <strong className="text-[10px]">{sessionStopped ? "Session stopped" : "Pain Override"}</strong>
            <small className="mt-0.5 text-[8px] text-red-200/70" id="pain-override-hint">
              {sessionStopped ? "Reset the day to continue" : "Sharp pain or sudden loss of movement"}
            </small>
          </span>
        </button>
      </footer>
    </main>
  );
}
