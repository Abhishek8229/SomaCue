"use client";

import { useEffect, useRef } from "react";
import type { DetectedCondition, Escalation } from "@/lib/clinical/assessment";

/**
 * Full-platform lockout. A modal <dialog> sits in the browser's top layer, so
 * it covers the navbar too and makes everything else on the page inert.
 * Escape cannot dismiss it; the only action is starting a new intake.
 */
export function EscalationAlert({
  condition,
  escalation,
  onStartNewIntake,
}: {
  condition: DetectedCondition | null;
  escalation: Escalation;
  onStartNewIntake: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    // Blurs the page itself as well as the backdrop; the dialog renders in the
    // top layer, so it stays sharp. See the clinical-lock rule in globals.css.
    document.documentElement.dataset.clinicalLock = "true";
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    return () => {
      delete document.documentElement.dataset.clinicalLock;
      if (!dialog?.open) return;
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);

  const progress = escalation.kind === "progress";

  return (
    <dialog
      aria-describedby="escalation-reason"
      aria-labelledby="escalation-title"
      className="escalation-dialog"
      onCancel={(event) => event.preventDefault()}
      ref={dialogRef}
    >
      <div className="escalation-card w-full max-w-lg rounded-3xl p-7 text-left sm:p-8">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="escalation-icon grid h-12 w-12 shrink-0 place-items-center rounded-2xl">
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24">
              <path d="M12 8v5m0 3.5h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.74 3h14.92a2 2 0 0 0 1.74-3L13.7 3.8a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
            </svg>
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200">Clinical safety alert</p>
        </div>

        <h2 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-white" id="escalation-title">
          {progress
            ? "Stop your exercises and get seen in person"
            : "Stop. Please get in-person medical care now"}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-red-50/90" id="escalation-reason">
          {escalation.reason}
        </p>

        {condition ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/80">
            <span className="text-white/50">Detected condition: </span>
            {condition.title}
          </p>
        ) : null}

        {escalation.evidence.length > 0 ? (
          <div className="mt-4">
            <p className="text-[11px] font-semibold text-red-100">
              {progress ? "What your sessions showed" : "Warning signs in your intake"}
            </p>
            <ul className="mt-1.5 space-y-1">
              {escalation.evidence.map((item) => (
                <li className="flex gap-2 text-xs leading-relaxed text-white/80" key={item}>
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-300" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-red-300/30 bg-red-950/40 p-4">
          <p className="text-[11px] font-semibold text-white">What to do now</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-white/85">
            <li>Do not continue the exercises in this plan.</li>
            <li>
              Book an in-person appointment with a doctor or physiotherapist as soon as possible, and take
              your reports and scans with you.
            </li>
            <li>
              If you have loss of bladder or bowel control, numbness in the groin, sudden or spreading
              weakness, chest pain or severe uncontrolled pain, call your local emergency number or go to
              the nearest emergency department now.
            </li>
          </ol>
        </div>

        <div className="mt-6 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-relaxed text-white/50">
            Guided exercises stay paused for this case.
          </p>
          <button
            className="escalation-action rounded-xl px-4 py-2.5 text-xs font-semibold"
            onClick={onStartNewIntake}
            type="button"
          >
            Start a new intake
          </button>
        </div>
      </div>
    </dialog>
  );
}
