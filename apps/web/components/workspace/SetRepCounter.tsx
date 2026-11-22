"use client";

import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import type { Celebration } from "@/components/stage/useRepCelebration";
import type { RepProgress } from "@/lib/kinematics/progress";

/** Above this many reps the track is one continuous bar instead of segments. */
const MAX_SEGMENTS = 12;
/** Above this many sets the badge drops its pips (they would not fit). */
const MAX_PIPS = 8;
const PARTICLE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

type SetRepCounterProps = {
  sets: number;
  reps: number;
  progress: RepProgress;
  celebration: Celebration | null;
  reducedMotion: boolean;
};

/**
 * Footer counter for the current exercise: a set badge with one pip per set
 * and a per-rep track. A finished rep gets a small pop; a finished set gets a
 * burst of rings and particles around the badge.
 */
export function SetRepCounter({ sets, reps, progress, celebration, reducedMotion }: SetRepCounterProps) {
  const { set, setsDone, repsDoneInSet, allDone } = progress;
  const repPop = celebration?.kind === "rep" ? celebration.id : null;
  const setBurst = celebration?.kind === "set" ? celebration.id : null;
  const segmented = reps <= MAX_SEGMENTS;
  const percent = reps > 0 ? Math.round((repsDoneInSet / reps) * 100) : 0;

  return (
    <div aria-label="Set and rep progress" className="relative mt-1 flex items-center gap-3" role="group">
      <div
        className={`relative flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-lg border transition-colors duration-300 ${
          allDone ? "border-emerald-300/50 bg-emerald-300/15" : "border-white/15 bg-white/5"
        } ${setBurst !== null ? "rep-counter-badge-burst" : ""}`}
        data-testid="set-badge"
        key={setBurst !== null ? `badge-${setBurst}` : "badge"}
      >
        <span className="text-[8px] font-semibold uppercase leading-none tracking-[0.14em] text-white/45">Set</span>
        <span className="mt-0.5 font-mono text-xs font-semibold leading-none tabular-nums text-white">
          {set}
          <span className="text-white/40">/{sets}</span>
        </span>
        {sets <= MAX_PIPS ? (
          <span aria-hidden="true" className="mt-1 flex gap-0.5">
            {Array.from({ length: sets }, (_, index) => (
              <span
                className={`h-1 w-1 rounded-full ${index < setsDone ? "bg-emerald-300" : "bg-white/20"}`}
                data-filled={index < setsDone}
                data-testid="set-pip"
                key={index}
              />
            ))}
          </span>
        ) : null}
        {setBurst !== null && !reducedMotion ? (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0" key={`burst-${setBurst}`}>
            <span className="rep-counter-ring" />
            <span className="rep-counter-ring rep-counter-ring-late" />
            {PARTICLE_ANGLES.map((angle) => (
              <span
                className="rep-counter-particle"
                key={angle}
                style={{ "--rep-counter-angle": `${angle}deg` } as CSSProperties}
              />
            ))}
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        {allDone ? (
          <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-200" data-testid="rep-count">
            <Check aria-hidden="true" size={12} strokeWidth={2.6} />
            All sets done
          </p>
        ) : (
          <p className="text-[11px] text-white/80" data-testid="rep-count">
            Rep{" "}
            <span
              className={`inline-block font-semibold tabular-nums text-white ${repPop !== null ? "rep-counter-pop" : ""}`}
              key={repPop !== null ? `rep-${repPop}` : "rep"}
            >
              {repsDoneInSet}
            </span>{" "}
            of {reps}
          </p>
        )}
        {segmented ? (
          <div
            aria-hidden="true"
            className={`mt-1.5 flex h-1.5 w-36 gap-[3px] ${setBurst !== null ? "rep-counter-track-complete" : ""}`}
            key={setBurst !== null ? `track-${setBurst}` : "track"}
          >
            {Array.from({ length: reps }, (_, index) => {
              const filled = index < repsDoneInSet;
              const fresh = repPop !== null && index === repsDoneInSet - 1;
              return (
                <span
                  className={`flex-1 rounded-full transition-colors duration-200 ${filled ? "bg-emerald-300" : "bg-white/15"} ${
                    fresh ? "rep-counter-segment-flash" : ""
                  }`}
                  data-filled={filled}
                  data-testid="rep-segment"
                  key={fresh ? `segment-${index}-${repPop}` : `segment-${index}`}
                />
              );
            })}
          </div>
        ) : (
          <div
            aria-hidden="true"
            className={`mt-1.5 h-1.5 w-36 rounded-full bg-white/15 ${setBurst !== null ? "rep-counter-track-complete" : ""}`}
            key={setBurst !== null ? `bar-${setBurst}` : "bar"}
          >
            <span
              className={`block h-full rounded-full bg-emerald-300 transition-[width] duration-300 ease-out ${
                repPop !== null ? "rep-counter-segment-flash" : ""
              }`}
              data-testid="rep-bar"
              key={repPop !== null ? `fill-${repPop}` : "fill"}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      {setBurst !== null ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-14 z-10 flex items-center" key={`label-${setBurst}`}>
          <span className="rep-counter-set-label flex items-center gap-1 whitespace-nowrap rounded-full border border-emerald-300/40 bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-emerald-100 shadow-[0_0_18px_rgba(110,231,183,0.25)]">
            <Check aria-hidden="true" size={11} strokeWidth={2.6} />
            Set {setsDone} complete
          </span>
        </span>
      ) : null}

      <span className="sr-only" role="status">
        {setBurst !== null ? `Set ${setsDone} complete` : ""}
      </span>
    </div>
  );
}
