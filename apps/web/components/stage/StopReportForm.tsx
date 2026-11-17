"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { FEEDBACK_TEXT_MAX } from "@/lib/progress/dailyProgress";
import {
  PAIN_TYPES,
  PAIN_TYPE_LABELS,
  validatePainDraft,
  type PainType,
} from "@/lib/progress/painEvent";
import { REGIONS, REGION_LABELS, type Region } from "@/lib/kinematics/vocabulary";
import { SafetyNotice } from "./SafetyNotice";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

const FOCUSABLE =
  'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type StopReportSubmission = {
  exerciseNames: string[];
  painType: PainType;
  regions: Region[];
  details: string;
};

export type StopReportFormProps = {
  exercises: string[];
  initialExercise: string | null;
  initialRegions: Region[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (submission: StopReportSubmission) => void;
  onClose: () => void;
};

export function StopReportForm({
  exercises,
  initialExercise,
  initialRegions,
  isSubmitting,
  errorMessage,
  onSubmit,
  onClose,
}: StopReportFormProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [exerciseNames, setExerciseNames] = useState<string[]>(
    initialExercise && exercises.includes(initialExercise) ? [initialExercise] : [],
  );
  const [painType, setPainType] = useState<PainType | null>(null);
  const [regions, setRegions] = useState<Region[]>(initialRegions);
  const [details, setDetails] = useState("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  const { valid, errors } = validatePainDraft({ exerciseNames, painType, regions, details });
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const submit = () => {
    if (!valid || isSubmitting || !painType) return;
    onSubmit({ exerciseNames, painType, regions, details: details.trim() });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!isSubmitting) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-zinc-950/85 p-4 backdrop-blur-sm">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-3xl border border-red-300/30 bg-zinc-900 p-6 text-white outline-none"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <p className="text-[10px] font-medium text-red-300">Pain Override · session stopped</p>
        <h2 className="mt-2 text-xl font-medium tracking-tight" id={titleId}>
          Stop and report
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-white/60">
          Your session has been stopped and the figure is resting. Tell us what happened so your plan
          avoids this movement.
        </p>

        <div className="mt-4">
          <SafetyNotice />
        </div>

        <fieldset className="mt-5">
          <legend className="text-xs text-white/85">Which exercise caused it?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {exercises.map((name) => {
              const selected = exerciseNames.includes(name);
              return (
                <button
                  aria-pressed={selected}
                  className={`${interactive} rounded-full border px-3 py-1.5 text-[11px] ${
                    selected
                      ? "border-red-300/70 bg-red-300/15 text-red-100"
                      : "border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
                  }`}
                  disabled={isSubmitting}
                  key={name}
                  onClick={() => setExerciseNames((list) => toggle(list, name))}
                  type="button"
                >
                  {name}
                </button>
              );
            })}
          </div>
          {errors.exerciseNames ? <p className="mt-2 text-[10px] text-white/55">{errors.exerciseNames}</p> : null}
        </fieldset>

        <div aria-label="What happened" className="mt-5 grid gap-2 sm:grid-cols-3" role="radiogroup">
          {PAIN_TYPES.map((value) => {
            const selected = painType === value;
            return (
              <button
                aria-checked={selected}
                className={`${interactive} rounded-xl border px-3 py-2.5 text-left text-xs ${
                  selected
                    ? "border-red-300/70 bg-red-300/15 text-red-100"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
                }`}
                disabled={isSubmitting}
                key={value}
                onClick={() => setPainType(value)}
                role="radio"
                type="button"
              >
                {PAIN_TYPE_LABELS[value]}
              </button>
            );
          })}
        </div>
        {errors.painType ? <p className="mt-2 text-[10px] text-white/55">{errors.painType}</p> : null}

        <fieldset className="mt-5">
          <legend className="text-xs text-white/85">Where did you feel it?</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REGIONS.map((region) => {
              const selected = regions.includes(region);
              return (
                <button
                  aria-pressed={selected}
                  className={`${interactive} rounded-full border px-2.5 py-1 text-[10px] ${
                    selected
                      ? "border-red-300/70 bg-red-300/15 text-red-100"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/25 hover:text-white"
                  }`}
                  disabled={isSubmitting}
                  key={region}
                  onClick={() => setRegions((list) => toggle(list, region))}
                  type="button"
                >
                  {REGION_LABELS[region]}
                </button>
              );
            })}
          </div>
          {errors.regions ? <p className="mt-2 text-[10px] text-white/55">{errors.regions}</p> : null}
        </fieldset>

        <div className="mt-5">
          <label className="text-xs text-white/85" htmlFor={`${titleId}-details`}>
            What happened, in your own words
          </label>
          <textarea
            aria-required="true"
            className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/15 bg-zinc-950 p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/40 focus:border-red-300/60"
            disabled={isSubmitting}
            id={`${titleId}-details`}
            maxLength={FEEDBACK_TEXT_MAX}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="For example: sharp pain in my lower back as I lifted my chest."
            value={details}
          />
          {errors.details ? <p className="mt-2 text-[10px] text-white/55">{errors.details}</p> : null}
        </div>

        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs text-red-100" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            className={`${interactive} rounded-xl px-4 py-2.5 text-xs text-white/65 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
          <button
            className={`${interactive} rounded-xl bg-red-300 px-4 py-2.5 text-xs font-semibold text-black hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!valid || isSubmitting}
            onClick={submit}
            type="button"
          >
            {isSubmitting ? "Saving report…" : "Save report"}
          </button>
        </div>
      </section>
    </div>
  );
}
