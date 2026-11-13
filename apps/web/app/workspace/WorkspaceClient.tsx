"use client";

import { useEffect, useMemo, useState } from "react";
import { completeTriageQuiz, reschedulePlanFromFeedback } from "@/actions/intake";
import type { TriageQuestion } from "@/actions/generatePlan";
import {
  QuizModal,
  SidebarIntake,
  StagePanel,
  type FlowPhase,
  type InitialQuiz,
  type TreatmentPlanPayload,
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

export default function WorkspacePage({
  hasActivePlan,
  initialQuiz,
  reportId,
  routine,
}: {
  hasActivePlan: boolean;
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [reportsSubmitted, setReportsSubmitted] = useState(
    hasActivePlan || initialQuiz !== null,
  );
  const [hasUploadedReports, setHasUploadedReports] = useState(false);
  const [planUnlocked, setPlanUnlocked] = useState(hasActivePlan);
  const [treatmentPlan, setTreatmentPlan] = useState(routine);
  const [triageQuiz, setTriageQuiz] = useState(initialQuiz);
  const [activeReportId, setActiveReportId] = useState(reportId);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [flowPhase, setFlowPhase] = useState<FlowPhase>(
    hasActivePlan ? "ready" : initialQuiz ? "quiz" : "discovery",
  );
  const [flowError, setFlowError] = useState<string | null>(null);
  const [loaderIndex, setLoaderIndex] = useState(0);
  const [patientFeedback, setPatientFeedback] = useState<"relief" | "same" | "issue" | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);

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

  const loadingMessages =
    flowPhase === "preparing"
      ? hasUploadedReports
        ? [
            "Extracting clinical notes from uploaded documents...",
            "Analyzing visual medical reports...",
            "Cross-referencing musculoskeletal constraints...",
            "Formulating targeted diagnostic questions...",
          ]
        : [
            "Evaluating symptom descriptions...",
            "Cross-referencing musculoskeletal databases...",
            "Mapping relevant safety considerations...",
            "Formulating targeted diagnostic questions...",
          ]
      : [
          "Synthesizing diagnostic feedback...",
          "Calculating safe range-of-motion limits...",
          "Mapping movement cues to the 3D anatomical stage...",
          "Building a gentle progression for today...",
        ];

  useEffect(() => {
    if (!isFlowLocked || flowPhase === "quiz") {
      return;
    }

    const timer = window.setInterval(() => {
      setLoaderIndex((index) => (index + 1) % loadingMessages.length);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [flowPhase, isFlowLocked, loadingMessages.length]);

  const activeJourneyMonthKey = journeyMonths.some((month) => month.key === selectedMonth)
    ? selectedMonth
    : journeyMonths[0]?.key;

  const handlePreparing = (hasFiles: boolean) => {
    setHasUploadedReports(hasFiles);
    setFlowError(null);
    setLoaderIndex(0);
    setFlowPhase("preparing");
  };

  const handleTriageReady = (result: {
    reportId: string;
    quizId: string;
    questions: TriageQuestion[];
  }) => {
    setTriageQuiz({
      id: result.quizId,
      reportId: result.reportId,
      questions: result.questions,
    });
    setActiveReportId(result.reportId);
    setQuizAnswers({});
    setReportsSubmitted(true);
    setPlanUnlocked(false);
    setFlowPhase("quiz");
  };

  const handleRerunAnalysis = () => {
    setReportsSubmitted(false);
    setHasUploadedReports(false);
    setPlanUnlocked(false);
    setTreatmentPlan(null);
    setTriageQuiz(null);
    setActiveReportId(null);
    setQuizAnswers({});
    setFlowError(null);
    setFlowPhase("discovery");
  };

  const handleFeedback = async (feedback: "relief" | "same" | "issue") => {
    setPatientFeedback(feedback);
    setFeedbackError(null);
    if (!activeReportId || !treatmentPlan) {
      return;
    }

    setFeedbackPending(true);
    try {
      const result = await reschedulePlanFromFeedback(activeReportId, feedback);
      if (!("error" in result)) {
        setTreatmentPlan((currentPlan) =>
          currentPlan ? { ...currentPlan, schedule: result.schedule } : currentPlan,
        );
        setSelectedDayOffset(0);
      } else {
        setFeedbackError(
          result.error === "AI_PROVIDER_TIMEOUT"
            ? "The schedule update timed out. Please try again."
            : "The schedule could not be updated. Please try again.",
        );
      }
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "Unable to update the schedule.");
    } finally {
      setFeedbackPending(false);
    }
  };

  const handleCompleteQuiz = async () => {
    if (!triageQuiz) {
      return;
    }

    setFlowError(null);
    setLoaderIndex(0);
    setFlowPhase("finalizing");

    try {
      const result = await completeTriageQuiz(
        triageQuiz.reportId,
        triageQuiz.id,
        quizAnswers,
      );
      if (!("error" in result)) {
        setTreatmentPlan(result.routine);
        setPlanUnlocked(true);
        setFlowPhase("ready");
      } else {
        setFlowPhase("quiz");
        setFlowError(
          result.error === "AI_PROVIDER_TIMEOUT"
            ? "The AI provider timed out after 60 seconds. Please try again."
            : "The AI provider is unavailable. Please try again later.",
        );
      }
    } catch (error) {
      setFlowPhase("quiz");
      setFlowError(error instanceof Error ? error.message : "Unable to complete the triage.");
    }
  };

  const quizComplete =
    triageQuiz !== null &&
    triageQuiz.questions.every((question) => (quizAnswers[question.id] ?? "").trim().length > 0);

  return (
    <main
      aria-busy={isFlowLocked}
      className="workspace-shell relative flex h-screen flex-col overflow-hidden bg-zinc-950 text-white"
    >
      <header className="workspace-header flex h-16 shrink-0 items-center justify-between border-b border-white/15 bg-zinc-900 px-5">
        <div className="flex min-w-[220px] items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-300/50 bg-emerald-300/10 text-lg font-semibold text-emerald-200">
            S
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">SomaCue</p>
            <p className="text-[10px] text-white/60">Clinical workspace / Jordan Lee</p>
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
          <button className={`${interactive} text-[11px] text-white/65 hover:text-white`} type="button">
            Patient History
          </button>
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
          />
        </div>

        <StagePanel
          planUnlocked={planUnlocked}
          reportsSubmitted={reportsSubmitted}
          selectedCareDay={selectedCareDay}
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
                    const isSelected = selectedCareDay.key === dateKey;
                    const isToday =
                      date.toDateString() === new Date().toDateString();
                    const isBeforeScheduleStart = date < scheduleStartDate;
                    const isBeyondScheduleHorizon = date > scheduleEndDate;

                    return (
                      <button
                        aria-label={`${calendarMonthLabel} ${day}`}
                        className={`${interactive} mx-auto grid h-7 w-7 place-items-center rounded-md text-[11px] ${
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
              <>
            <section className="workspace-panel rounded-2xl border border-white/15 bg-zinc-900 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="mb-1 text-[9px] font-medium text-emerald-300">02 / daily prescription</p>
                  <h2 className="text-base font-medium tracking-tight">
                    {selectedCareDay.status === "rest" ? "Recovery day" : `${selectedCareDay.day}'s plan`}
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] text-emerald-200">
                  {selectedCareDay.focus}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-white/55">{selectedCareDay.tagline}</p>
              <div className="mt-4 flex flex-col gap-2">
                {treatmentPlan?.steps.map((step, index) => (
                  <button
                    className={`${interactive} flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left hover:border-emerald-300/50 hover:bg-white/10`}
                    key={`${step.animationTriggerId}-${index}`}
                    type="button"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-300/15 font-mono text-[9px] text-emerald-300">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[11px] font-medium text-white/90">{step.exerciseName}</strong>
                      <small className="mt-1 block text-[10px] text-white/60">{step.durationSeconds}s guided movement</small>
                      <span className="mt-2 block text-[10px] leading-relaxed text-emerald-100/70">“{step.voiceCue}”</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="workspace-panel workspace-live min-h-0 flex-1 rounded-2xl border border-white/15 bg-zinc-900 p-4 font-mono">
              <p className="mb-1 text-[9px] text-emerald-300">Live dictation</p>
              <h2 className="font-sans text-base font-medium tracking-tight">Movement cues</h2>
              <div className="mt-6 space-y-4 text-[10px] leading-relaxed text-white/65">
                <p><span className="mr-3 text-white/30">00:12</span>▶ Bend your knee slowly…</p>
                <p><span className="mr-3 text-white/30">00:08</span>Keep the heel connected to the floor.</p>
                <p className="text-white/35"><span className="mr-3">00:03</span>Pause at the comfortable limit.</p>
              </div>
              <div className="mt-7 border-t border-white/10 pt-4 font-sans">
                <p className="text-xs font-medium text-white/85">How did your body feel after this?</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    ["relief", "More relief"],
                    ["same", "About the same"],
                    ["issue", "More discomfort"],
                  ].map(([value, label]) => (
                    <button
                      className={`${interactive} rounded-lg border px-2 py-2 text-[10px] ${
                        patientFeedback === value
                          ? value === "issue"
                            ? "border-red-300/70 bg-red-300/15 text-red-100"
                            : "border-emerald-300/70 bg-emerald-300/15 text-emerald-100"
                          : "border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:text-white"
                      }`}
                      key={value}
                      disabled={feedbackPending}
                      onClick={() => handleFeedback(value as "relief" | "same" | "issue")}
                      type="button"
                    >
                      {feedbackPending && patientFeedback === value ? "Updating…" : label}
                    </button>
                  ))}
                </div>
                {feedbackError ? (
                  <p className="mt-2 text-[10px] text-red-200">{feedbackError}</p>
                ) : null}
              </div>
            </section>
              </>
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
          ) : (
            <section aria-live="polite" className="w-full max-w-md rounded-3xl border border-emerald-200/20 bg-zinc-900 p-8 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-emerald-300/40 bg-emerald-300/10 text-xl text-emerald-200">
                ✦
              </div>
              <p className="mt-6 text-[10px] font-medium text-emerald-300">
                {flowPhase === "preparing" ? "Diagnostic triage" : "Treatment synthesis"}
              </p>
              <h2 className="mt-2 text-xl font-medium tracking-tight">{loadingMessages[loaderIndex]}</h2>
              <div className="mt-6 flex justify-center gap-1.5">
                {loadingMessages.map((message, index) => (
                  <span className={`h-1.5 rounded-full transition-colors duration-150 ${index === loaderIndex ? "w-8 bg-emerald-300" : "w-1.5 bg-white/20"}`} key={message} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}

      <footer className="flex h-20 shrink-0 items-center justify-between border-t border-white/15 bg-zinc-900 px-5">
        <div className="min-w-[220px]">
          <p className="text-[10px] text-emerald-300">Session 04</p>
          <p className="mt-1 text-xs text-white/80">Set 2 of 3 <span className="text-white/35">•</span> 12 Reps</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={`${interactive} rounded-lg px-2 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white`} type="button">Prev</button>
          <button aria-label={isPlaying ? "Pause playback" : "Play playback"} className={`${interactive} grid h-10 w-10 place-items-center rounded-full bg-emerald-300 text-black`} onClick={() => setIsPlaying((value) => !value)} type="button">
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button className={`${interactive} rounded-lg px-2 py-1 text-[10px] text-white/65 hover:bg-white/10 hover:text-white`} type="button">Next</button>
          <div className="ml-3 flex rounded-lg border border-white/10 bg-black/25 p-1">
            <button className={`${interactive} rounded px-2 py-1 font-mono text-[9px] text-white/45 hover:text-white`} type="button">0.5x</button>
            <button className={`${interactive} rounded bg-white/10 px-2 py-1 font-mono text-[9px] text-white`} type="button">1.0x</button>
          </div>
          <button className={`${interactive} ml-3 flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-[10px] text-white/65 hover:border-emerald-300/50 hover:text-emerald-300`} onClick={() => setIsListening((value) => !value)} type="button">
            <span className={isListening ? "text-emerald-300" : "text-white/55"}>●</span>
            {isListening ? "Listening" : "Voice feedback"}
          </button>
        </div>
        <button className={`${interactive} flex min-w-[155px] items-center gap-3 whitespace-nowrap rounded-xl border border-red-400/60 bg-red-400/10 px-3 py-2 text-left text-red-100 hover:bg-red-400/20`} type="button">
          <span className="grid h-7 w-7 place-items-center rounded-lg border border-red-400/70 font-mono text-sm text-red-400">!</span>
          <span className="flex flex-col whitespace-nowrap">
            <strong className="text-[10px]">Pain Override</strong>
            <small className="mt-0.5 text-[8px] text-red-200/70">Halt session</small>
          </span>
        </button>
      </footer>
    </main>
  );
}
