"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { ExerciseStep } from "@/lib/progress/dailyProgress";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

export type DailyPrescriptionPanelProps = {
  dayLabel: string;
  status: "active" | "upcoming" | "rest";
  focus: string;
  tagline: string;
  steps: ExerciseStep[];
  completedExercises: string[];
  isDayCompleted: boolean;
  /** False for dates other than today, where progress cannot be recorded yet. */
  canInteract: boolean;
  /** Exercise whose save is in flight. Every toggle waits while one is pending. */
  pendingExercise: string | null;
  errorMessage: string | null;
  onToggleExercise: (exerciseName: string, checked: boolean) => void;
  onDone: () => void;
  onReset: () => void;
  /** True while the reset request is in flight. */
  isResetting: boolean;
  /** Stopped with Pain Override: the day is not completed and can only be reset. */
  isStopped?: boolean;
  /** Shown in the stopped banner, for example the reschedule status. */
  stopMessage?: string | null;
  /** Opens the stop report when it has not been filed yet. */
  onReportStop?: (() => void) | null;
  stopActionLabel?: string;
};

export function DailyPrescriptionPanel({
  dayLabel,
  status,
  focus,
  tagline,
  steps,
  completedExercises,
  isDayCompleted,
  canInteract,
  pendingExercise,
  errorMessage,
  onToggleExercise,
  onDone,
  onReset,
  isResetting,
  isStopped = false,
  stopMessage = null,
  onReportStop = null,
  stopActionLabel = "Report what happened",
}: DailyPrescriptionPanelProps) {
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const isRest = status === "rest";
  const completedCount = steps.filter((step) =>
    completedExercises.includes(step.exerciseName),
  ).length;
  const togglesLocked = !canInteract || isDayCompleted || isStopped || pendingExercise !== null;

  const resetControls = canInteract ? (
    <div className="flex shrink-0 items-center gap-1">
      {isConfirmingReset ? (
        <>
          <button
            className={`${interactive} rounded-lg border border-red-300/50 bg-red-300/10 px-2 py-1 text-[10px] font-medium text-red-100 hover:bg-red-300/20`}
            onClick={() => {
              setIsConfirmingReset(false);
              onReset();
            }}
            type="button"
          >
            Confirm reset?
          </button>
          <button
            className={`${interactive} rounded-lg px-2 py-1 text-[10px] text-white/60 hover:bg-white/10 hover:text-white`}
            onClick={() => setIsConfirmingReset(false)}
            type="button"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          className={`${interactive} rounded-lg border border-white/15 px-2 py-1 text-[10px] text-white/60 hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={isResetting}
          onClick={() => setIsConfirmingReset(true)}
          type="button"
        >
          {isResetting ? "Resetting…" : "Reset"}
        </button>
      )}
    </div>
  ) : null;

  return (
    <section className="workspace-panel rounded-2xl border border-white/15 bg-zinc-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="mb-1 text-[9px] font-medium text-emerald-300">02 / daily prescription</p>
          <h2 className="text-base font-medium tracking-tight">
            {isRest ? "Recovery day" : `${dayLabel}'s plan`}
          </h2>
        </div>
        <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] text-emerald-200">
          {focus}
        </span>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-white/55">{tagline}</p>

      {isRest ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-[10px] leading-relaxed text-white/60">
          Nothing is prescribed today. Rest and let your body recover.
        </p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-2">
            {steps.map((step, index) => {
              const isChecked = completedExercises.includes(step.exerciseName);
              return (
                <li
                  className={`flex items-center gap-3 rounded-xl border p-3 transition-colors duration-150 ${
                    isChecked
                      ? "border-emerald-300/50 bg-emerald-300/10"
                      : "border-white/10 bg-black/20"
                  }`}
                  data-completed={isChecked}
                  key={`${step.animationTriggerId}-${index}`}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-300/15 font-mono text-[9px] text-emerald-300">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong
                      className={`block truncate text-[11px] font-medium ${
                        isChecked ? "text-white/60 line-through" : "text-white/90"
                      }`}
                    >
                      {step.exerciseName}
                    </strong>
                    <small className="mt-1 block text-[10px] text-white/60">
                      {step.durationSeconds}s guided movement
                    </small>
                    <span className="mt-2 block text-[10px] leading-relaxed text-emerald-100/70">
                      “{step.voiceCue}”
                    </span>
                  </span>
                  <button
                    aria-checked={isChecked}
                    aria-label={`Mark ${step.exerciseName} complete`}
                    className={`${interactive} grid h-7 w-7 shrink-0 place-items-center rounded-lg border disabled:cursor-not-allowed ${
                      isChecked
                        ? "border-emerald-300 bg-emerald-300 text-black"
                        : "border-white/25 text-transparent hover:border-emerald-300/70 hover:text-emerald-300/60"
                    } ${togglesLocked && !isChecked ? "opacity-40" : ""}`}
                    disabled={togglesLocked}
                    onClick={() => onToggleExercise(step.exerciseName, !isChecked)}
                    role="checkbox"
                    type="button"
                  >
                    <Check aria-hidden="true" size={14} strokeWidth={3} />
                  </button>
                </li>
              );
            })}
          </ul>

          {isStopped ? (
            <div
              className="mt-4 rounded-xl border border-red-300/40 bg-red-400/10 px-3 py-3"
              role="status"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-red-100">Session stopped</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/60">
                    Stopped with Pain Override. This day is not counted as done.
                  </p>
                </div>
                {resetControls}
              </div>
              {stopMessage ? <p className="mt-2 text-[10px] text-white/70">{stopMessage}</p> : null}
              {onReportStop ? (
                <button
                  className={`${interactive} mt-3 w-full rounded-lg border border-red-300/50 px-3 py-2 text-[10px] font-semibold text-red-100 hover:bg-red-300/15`}
                  onClick={onReportStop}
                  type="button"
                >
                  {stopActionLabel}
                </button>
              ) : null}
            </div>
          ) : isDayCompleted ? (
            <div
              className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-300/40 bg-emerald-300/10 px-3 py-3"
              role="status"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-semibold text-emerald-100">
                  <Check aria-hidden="true" size={14} strokeWidth={3} />
                  Completed for today
                </p>
                <p className="mt-1 text-[10px] text-white/55">Your feedback has been recorded.</p>
              </div>
              {resetControls}
            </div>
          ) : (
            <div className="mt-4">
              <button
                className={`${interactive} w-full rounded-xl bg-emerald-300 px-3 py-3 text-xs font-semibold text-black hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-35`}
                disabled={!canInteract}
                onClick={onDone}
                type="button"
              >
                Done for today
              </button>
              <p className="mt-2 text-center text-[10px] text-white/45">
                {canInteract
                  ? `${completedCount} of ${steps.length} movements checked`
                  : "You can record progress on the day a plan is scheduled."}
              </p>
            </div>
          )}
        </>
      )}

      {errorMessage ? (
        <p className="mt-3 text-[10px] text-red-200" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}
