"use client";

import dynamic from "next/dynamic";
import { BookOpen, Volume2 } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import { CubeIcon, TextIcon } from "@/components/workspace/icons";
import { CLINICAL_RANGES_REVIEWED } from "@/lib/kinematics/joint-table";
import { describeSpec, type StageExercise } from "@/lib/kinematics/exercise";
import { stageInstruction, type StageInstruction } from "@/lib/kinematics/instructions";
import { defaultView, viewDescription, viewLabels } from "@/lib/kinematics/camera-presets";
import { PHASE_LABELS } from "@/lib/kinematics/timeline";
import { POSTURE_LABELS } from "@/lib/kinematics/vocabulary";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/use-environment";
import type { StageGlow, StageHud, StageStatus } from "./stage-types";
import { SafetyNotice } from "./SafetyNotice";
import { useStageSpeech } from "./useStageSpeech";
import { speechEnabled, type StageAction, type StageState } from "./useStageController";

const StageCanvas = dynamic(() => import("./StageCanvas"), { ssr: false });

const interactive =
  "transition-colors duration-150 ease-out active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

type StageV2Props = {
  reportsSubmitted: boolean;
  planUnlocked: boolean;
  dayLabel: string;
  exercises: StageExercise[];
  state: StageState;
  dispatch: (action: StageAction) => void;
  glow: Omit<StageGlow, "active">;
};

export const StageV2 = memo(function StageV2({
  reportsSubmitted,
  planUnlocked,
  dayLabel,
  exercises,
  state,
  dispatch,
  glow,
}: StageV2Props) {
  const webgl = useWebGLSupport();
  const reducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<StageStatus>("loading");
  const [textMode, setTextMode] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const exercise = exercises[state.index] ?? null;
  const spec = exercise?.spec ?? null;
  const posture = spec?.posture ?? "standing";
  const labels = viewLabels(posture);
  const activeView = state.view.view ?? defaultView(posture);
  // Stable per change, so the camera only reframes when the view really changes.
  const viewCommand = useMemo(() => ({ id: state.view.id, view: activeView }), [state.view.id, activeView]);
  const staticMode = textMode || webgl === "unavailable" || status === "error";
  const canInteract = reportsSubmitted && planUnlocked;

  const handleStatus = useCallback((next: StageStatus) => setStatus(next), []);
  const handleHud = useCallback((hud: StageHud) => dispatch({ type: "hud", hud }), [dispatch]);
  const handleFinished = useCallback(() => dispatch({ type: "finished" }), [dispatch]);

  const hud = state.hud;
  const description = spec ? describeSpec(spec) : null;
  useStageSpeech({
    exercise: canInteract && !staticMode ? exercise : null,
    hud,
    playing: state.playing,
    stopped: state.stopped,
    pace: state.pace,
    voiceOn: state.voiceOn,
    restartKey: state.restartKey,
    dispatch,
  });
  const listening = state.playing && state.pace === "guided" && Boolean(hud?.waitingStep);
  const instruction =
    canInteract && !state.stopped && !staticMode
      ? stageInstruction(
          exercise,
          hud && spec
            ? { phase: hud.phase, phaseRemaining: hud.phaseRemaining, rep: hud.rep, mirrored: hud.mirrored, playing: state.playing }
            : null,
        )
      : null;

  return (
    <section
      aria-label="3D movement stage"
      className={`workspace-stage ${planUnlocked ? "col-span-6" : "col-span-9"} relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-900 ${!reportsSubmitted ? "grayscale-[35%]" : ""}`}
      data-stage-panel
    >
      {canInteract && !staticMode && webgl === "available" ? (
        // The canvas starts below the caption band, so text never covers the figure.
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 top-[7.75rem]">
          <StageCanvas
            exerciseKey={`${state.index}-${state.restartKey}-${retryKey}`}
            glow={{ ...glow, active: [] }}
            key={retryKey}
            onFinished={handleFinished}
            onHud={handleHud}
            onStatus={handleStatus}
            playing={state.playing}
            reducedMotion={reducedMotion}
            guided={state.pace === "guided"}
            release={state.release}
            spec={spec}
            speed={state.speed}
            stopped={state.stopped}
            view={viewCommand}
          />
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-5 right-5 top-5 z-10 flex items-start justify-between gap-3 text-[10px]">
        <span className={`flex items-center gap-2 ${state.stopped ? "text-red-300" : "text-emerald-300"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${state.stopped ? "bg-red-300" : "bg-emerald-300"}`} />
          {state.stopped ? "session stopped" : state.playing ? "live motion" : "live stage"}
        </span>
        <span className="text-right text-white/60">
          {spec ? `${POSTURE_LABELS[posture]} · ${viewDescription(posture, activeView)}` : "anterior view · neutral"}
        </span>
      </div>

      {instruction ? <StageCaption instruction={instruction} listening={listening} voiceOn={speechEnabled(state)} /> : null}

      {canInteract && state.stopped ? (
        <div className="absolute left-5 right-5 top-12 z-10 mx-auto max-w-xl">
          <SafetyNotice compact />
        </div>
      ) : null}

      {canInteract && exercise ? (
        <div className="pointer-events-none absolute bottom-5 right-5 z-10 max-w-[60%] text-right">
          <p className="text-[10px] text-white/55">
            SomaCue stage / {dayLabel} · {state.index + 1} of {exercises.length}
          </p>
          <p className="mt-1 truncate text-sm text-white/90">{exercise.name}</p>
          <p className="mt-1 text-[10px] text-white/55" aria-live="polite">
            {state.stopped
              ? "Stopped. Resting safely."
              : hud?.phase
                ? `${PHASE_LABELS[hud.phase]} · rep ${hud.rep} of ${spec?.reps ?? 0}`
                : spec
                  ? "Press play to start"
                  : "No motion available, see the description"}
          </p>
          {exercise.source === "reference" ? (
            <p className="mt-1 text-[9px] text-white/35">Shown with a reference demonstration</p>
          ) : null}
        </div>
      ) : null}

      {canInteract ? (
        <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-2">
          {labels.map((label, view) => (
            <button
              aria-pressed={activeView === view}
              className={`${interactive} rounded-lg border px-3 py-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-35 ${
                activeView === view
                  ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-100"
                  : "border-white/15 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
              }`}
              disabled={staticMode}
              key={label}
              onClick={() => dispatch({ type: "view", view: view as 0 | 1 })}
              type="button"
            >
              {label}
            </button>
          ))}
          {webgl === "available" ? (
            <button
              aria-pressed={textMode}
              className={`${interactive} flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[10px] text-white/70 hover:bg-white/20 hover:text-white`}
              onClick={() => setTextMode((value) => !value)}
              type="button"
            >
              {textMode ? <CubeIcon size={12} /> : <TextIcon size={12} />}
              {textMode ? "3D view" : "Text view"}
            </button>
          ) : null}
          {!CLINICAL_RANGES_REVIEWED ? (
            <span className="rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-[9px] text-amber-100/80">
              Prototype · ranges not clinically reviewed
            </span>
          ) : null}
        </div>
      ) : null}

      {canInteract && !staticMode && webgl === "available" && status === "loading" ? (
        <div className="absolute inset-0 z-10 grid place-items-center" role="status">
          <p className="rounded-xl border border-white/15 bg-zinc-950/80 px-4 py-2 text-xs text-white/70">
            Loading the 3D body…
          </p>
        </div>
      ) : null}

      {canInteract && staticMode ? (
        <div className="absolute inset-0 z-[5] overflow-y-auto p-6 pt-14" role="region" aria-label="Exercise description">
          <div className="mx-auto max-w-md rounded-2xl border border-white/15 bg-zinc-950/90 p-5">
            {status === "error" && !textMode ? (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
                <span>The 3D body did not load. Showing the exercise as text.</span>
                <button
                  className={`${interactive} shrink-0 rounded-lg border border-amber-300/40 px-2 py-1 text-[10px]`}
                  onClick={() => {
                    setStatus("loading");
                    setRetryKey((key) => key + 1);
                  }}
                  type="button"
                >
                  Try 3D again
                </button>
              </div>
            ) : webgl === "unavailable" ? (
              <p className="mb-4 text-[11px] text-white/55">3D is not available in this browser.</p>
            ) : null}
            {exercise ? (
              <>
                <p className="text-[10px] text-emerald-300">{spec ? POSTURE_LABELS[posture] : "Exercise"}</p>
                <h3 className="mt-1 text-base font-medium">{exercise.name}</h3>
                <p className="mt-2 text-[11px] leading-relaxed text-emerald-100/75">“{exercise.voiceCue}”</p>
                {description ? (
                  <dl className="mt-4 space-y-2 text-[11px] text-white/70">
                    <div>
                      <dt className="text-white/45">Movement</dt>
                      <dd>{description.movements.join(", ")}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Tempo</dt>
                      <dd>{description.tempo}</dd>
                    </div>
                    <div>
                      <dt className="text-white/45">Dose</dt>
                      <dd>{description.dose}</dd>
                    </div>
                    {spec?.cues.length ? (
                      <div>
                        <dt className="text-white/45">Cues</dt>
                        <dd>{spec.cues.join(" ")}</dd>
                      </div>
                    ) : null}
                    {spec?.stopIf.length ? (
                      <div>
                        <dt className="text-white/45">Stop if</dt>
                        <dd>{spec.stopIf.join(" ")}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="mt-3 text-[11px] text-white/55">
                    This exercise has no motion data yet. Follow the spoken cue.
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] text-white/60">No exercises are scheduled for this day.</p>
            )}
          </div>
        </div>
      ) : null}

      {!canInteract ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-zinc-950/85 p-6 text-center">
          <div className="max-w-xs rounded-2xl border border-white/20 bg-zinc-950 px-5 py-4">
            <p className="text-sm font-medium">3D stage locked</p>
            <p className="mt-2 text-xs leading-relaxed text-white/70">
              {reportsSubmitted
                ? "Finish the triage questions to unlock your movement plan."
                : "Submit the patient reports and symptom notes to activate the movement stage."}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
});

const TONE_STYLES: Record<StageInstruction["tone"], string> = {
  neutral: "border-white/15 bg-white/10 text-white/75",
  active: "border-emerald-300/40 bg-emerald-300/15 text-emerald-100",
  hold: "border-amber-300/40 bg-amber-300/15 text-amber-100",
  rest: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  done: "border-emerald-300/40 bg-emerald-300/15 text-emerald-100",
};

/**
 * The live instruction above the figure. It sits in its own band at the top
 * of the stage; the 3D canvas starts below it.
 */
function StageCaption({
  instruction,
  listening,
  voiceOn,
}: {
  instruction: StageInstruction;
  /** guided pace: the figure is waiting for this instruction to finish */
  listening: boolean;
  voiceOn: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-5 top-9 z-10 flex h-[5.25rem] flex-col items-center justify-center text-center">
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TONE_STYLES[instruction.tone]}`}>
          {instruction.tag}
          {instruction.countdown !== null ? (
            <span aria-hidden="true" className="ml-1.5 font-mono tabular-nums">
              {instruction.countdown}s
            </span>
          ) : null}
        </span>
        {instruction.side ? (
          <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] text-white/70">
            {instruction.side}
          </span>
        ) : null}
        {listening ? (
          <span className="flex items-center gap-1 rounded-full border border-emerald-300/30 px-2.5 py-0.5 text-[10px] text-emerald-200">
            {voiceOn ? (
              <Volume2 aria-hidden="true" className="motion-safe:animate-pulse" size={11} />
            ) : (
              <BookOpen aria-hidden="true" size={11} />
            )}
            {voiceOn ? "Listen first" : "Read first"}
          </span>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className="stage-caption-in mt-1.5 line-clamp-2 max-w-2xl text-[15px] font-medium leading-snug text-white sm:text-base"
        key={`${instruction.tag}-${instruction.text}`}
        title={instruction.text}
      >
        {instruction.text}
      </p>
      {instruction.detail ? (
        <p className="mt-1 max-w-2xl truncate text-[11px] text-white/55">{instruction.detail}</p>
      ) : null}
    </div>
  );
}
