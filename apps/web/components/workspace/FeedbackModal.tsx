"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  FEEDBACK_OPTIONS,
  FEEDBACK_TEXT_MAX,
  validateFeedbackDraft,
  type FeedbackChoice,
  type FeedbackSubmission,
} from "@/lib/progress/dailyProgress";

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

const FOCUSABLE =
  'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type FeedbackModalProps = {
  exercises: string[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmit: (submission: FeedbackSubmission) => void;
  onClose: () => void;
};

export function FeedbackModal({
  exercises,
  isSubmitting,
  errorMessage,
  onSubmit,
  onClose,
}: FeedbackModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const [feedback, setFeedback] = useState<FeedbackChoice | null>(null);
  const [notes, setNotes] = useState("");
  const [discomfortExercises, setDiscomfortExercises] = useState<string[]>([]);
  const [discomfortDetails, setDiscomfortDetails] = useState("");

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const { valid, errors } = validateFeedbackDraft({
    feedback,
    notes,
    discomfortExercises,
    discomfortDetails,
  });
  const isIssue = feedback === "issue";

  const chooseFeedback = (choice: FeedbackChoice) => {
    setFeedback(choice);
    if (choice === "issue") {
      setNotes("");
    } else {
      setDiscomfortExercises([]);
      setDiscomfortDetails("");
    }
  };

  const toggleExercise = (name: string) =>
    setDiscomfortExercises((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );

  const submit = () => {
    if (!valid || isSubmitting || feedback === null) {
      return;
    }

    onSubmit(
      feedback === "issue"
        ? { feedback, discomfortExercises, discomfortDetails: discomfortDetails.trim() }
        : { feedback, notes: notes.trim() || undefined },
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!isSubmitting) {
        onClose();
      }
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }

    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitLabel = isSubmitting ? (isIssue ? "Updating your schedule…" : "Saving…") : "Submit feedback";

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-zinc-950/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="workspace-dialog max-h-full w-full max-w-md overflow-y-auto rounded-3xl border border-emerald-200/20 bg-zinc-900 p-6 text-white outline-none"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <p className="text-[10px] font-medium text-emerald-300">Post-session check-in</p>
        <h2 className="mt-2 text-xl font-medium tracking-tight" id={titleId}>
          How was the exercise today?
        </h2>

        <div aria-label="How the exercise felt" className="mt-5 grid gap-2" role="radiogroup">
          {FEEDBACK_OPTIONS.map((option) => {
            const isSelected = feedback === option.value;
            return (
              <button
                aria-checked={isSelected}
                className={`${interactive} rounded-xl border px-3 py-3 text-left text-xs ${
                  isSelected
                    ? option.value === "issue"
                      ? "border-red-300/70 bg-red-300/15 text-red-100"
                      : "border-emerald-300/70 bg-emerald-300/15 text-emerald-100"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
                }`}
                disabled={isSubmitting}
                key={option.value}
                onClick={() => chooseFeedback(option.value)}
                role="radio"
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {feedback !== null && !isIssue ? (
          <div className="mt-5">
            <label className="text-xs text-white/85" htmlFor={`${titleId}-notes`}>
              Notes (optional)
            </label>
            <textarea
              className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/15 bg-zinc-950 p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/40 focus:border-emerald-300/60"
              disabled={isSubmitting}
              id={`${titleId}-notes`}
              maxLength={FEEDBACK_TEXT_MAX}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything you want your plan to know?"
              value={notes}
            />
          </div>
        ) : null}

        {isIssue ? (
          <div className="mt-5 space-y-5">
            <fieldset>
              <legend className="text-xs text-white/85">Which exercises caused discomfort?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {exercises.map((name) => {
                  const isSelected = discomfortExercises.includes(name);
                  return (
                    <button
                      aria-pressed={isSelected}
                      className={`${interactive} rounded-full border px-3 py-1.5 text-[11px] ${
                        isSelected
                          ? "border-red-300/70 bg-red-300/15 text-red-100"
                          : "border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
                      }`}
                      disabled={isSubmitting}
                      key={name}
                      onClick={() => toggleExercise(name)}
                      type="button"
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
              {errors.discomfortExercises ? (
                <p className="mt-2 text-[10px] text-white/55">{errors.discomfortExercises}</p>
              ) : null}
            </fieldset>
            <div>
              <label className="text-xs text-white/85" htmlFor={`${titleId}-details`}>
                Describe the discomfort or what triggers the pain
              </label>
              <textarea
                aria-required="true"
                className="mt-2 min-h-24 w-full resize-y rounded-xl border border-white/15 bg-zinc-950 p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/40 focus:border-red-300/60"
                disabled={isSubmitting}
                id={`${titleId}-details`}
                maxLength={FEEDBACK_TEXT_MAX}
                onChange={(event) => setDiscomfortDetails(event.target.value)}
                placeholder="For example: sharp pain in the lower back when lifting the knee."
                value={discomfortDetails}
              />
              {errors.discomfortDetails ? (
                <p className="mt-2 text-[10px] text-white/55">{errors.discomfortDetails}</p>
              ) : null}
            </div>
            <p className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[10px] leading-relaxed text-amber-100">
              Your schedule for tomorrow and the days after will be adjusted to avoid or modify
              these movements.
            </p>
          </div>
        ) : null}

        {errorMessage ? (
          <p
            className="mt-4 rounded-xl border border-red-300/30 bg-red-300/10 px-3 py-2 text-xs text-red-100"
            role="alert"
          >
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
            Cancel
          </button>
          <button
            className={`${interactive} rounded-xl bg-emerald-300 px-4 py-2.5 text-xs font-semibold text-black hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!valid || isSubmitting}
            onClick={submit}
            type="button"
          >
            {submitLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
