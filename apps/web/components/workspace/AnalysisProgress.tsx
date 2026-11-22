"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AnalysisCopy } from "@/lib/analysis/progressCopy";

/** Waiting never shows more than this until the response arrives. */
const CEILING = 95;
const LINE_MIN_MS = 7000;
const LINE_JITTER_MS = 2000;
/** How long the ring takes to sweep to 100% once the response arrives. */
const ARRIVAL_SECONDS = 0.9;
/** How long 100% stays on screen before the next step opens. */
const COMPLETE_HOLD_MS = 650;

const SIZE = 184;
const CENTER = SIZE / 2;
const RADIUS = 72;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type AnalysisProgressProps = {
  eyebrow: string;
  copy: AnalysisCopy;
  /** Seconds for the ring to cover ~63% of the way to the ceiling. */
  timeConstant: number;
  doneMessage: string;
  footnote: string;
  /** The AI response has arrived: finish the ring, then call onComplete. */
  arrived: boolean;
  onComplete: () => void;
};

function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

export function AnalysisProgress({
  eyebrow,
  copy,
  timeConstant,
  doneMessage,
  footnote,
  arrived,
  onComplete,
}: AnalysisProgressProps) {
  const gradientId = useId();
  const glowId = useId();
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);

  const ringRef = useRef<HTMLDivElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const glowArcRef = useRef<SVGCircleElement>(null);
  const headRef = useRef<SVGGElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  const arrivedRef = useRef(arrived);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    arrivedRef.current = arrived;
    onCompleteRef.current = onComplete;
  });

  // One status line at a time, 7–9 s each, never looping. After the last
  // line, `step === lines.length` shows the hold message.
  useEffect(() => {
    if (arrived || step >= copy.lines.length) return;
    const timer = window.setTimeout(
      () => setStep((current) => current + 1),
      LINE_MIN_MS + Math.random() * LINE_JITTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [arrived, copy.lines.length, step]);

  // Ring physics. The target rises asymptotically toward the ceiling with a
  // gently varying rate, so it moves like real work (brief surges, brief
  // pauses) and never stalls or reaches the ceiling. The display value
  // chases the target with critically damped easing.
  useEffect(() => {
    let frame = 0;
    let completeTimer = 0;
    let last = performance.now();
    let elapsed = 0;
    let effective = 0;
    let shown = 0;
    let lastWhole = -1;
    let arrivalStart: number | null = null;
    let arrivalFrom = 0;
    const phaseA = Math.random() * Math.PI * 2;
    const phaseB = Math.random() * Math.PI * 2;

    const paint = (value: number) => {
      const offset = CIRCUMFERENCE * (1 - value / 100);
      arcRef.current?.style.setProperty("stroke-dashoffset", `${offset}`);
      glowArcRef.current?.style.setProperty("stroke-dashoffset", `${offset}`);
      headRef.current?.setAttribute("transform", `rotate(${value * 3.6} ${CENTER} ${CENTER})`);
      const whole = Math.floor(value);
      if (whole !== lastWhole) {
        lastWhole = whole;
        if (percentRef.current) percentRef.current.textContent = String(whole);
        ringRef.current?.setAttribute("aria-valuenow", String(whole));
      }
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      elapsed += dt;

      if (arrivedRef.current) {
        // A fixed-length ease-out from wherever the ring is to 100%, so the
        // finish feels decisive instead of creeping through 98–99%.
        if (arrivalStart === null) {
          arrivalStart = elapsed;
          arrivalFrom = shown;
        }
        const t = Math.min((elapsed - arrivalStart) / ARRIVAL_SECONDS, 1);
        shown = arrivalFrom + (100 - arrivalFrom) * (1 - (1 - t) ** 3);
        if (t >= 1) {
          paint(100);
          setFinished(true);
          completeTimer = window.setTimeout(() => onCompleteRef.current(), COMPLETE_HOLD_MS);
          return;
        }
        paint(shown);
        frame = window.requestAnimationFrame(tick);
        return;
      }

      const rate = 1 + 0.6 * Math.sin(elapsed * 0.83 + phaseA) * Math.sin(elapsed * 0.29 + phaseB);
      effective += dt * rate;
      const target = CEILING * (1 - Math.exp(-effective / timeConstant));
      shown += (target - shown) * (1 - Math.exp(-2.4 * dt));
      paint(Math.min(shown, CEILING));
      frame = window.requestAnimationFrame(tick);
    };

    paint(0);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(completeTimer);
    };
  }, [timeConstant]);

  const holding = step >= copy.lines.length;
  // On arrival, tick off the line that was on screen; never lines the user did not see.
  const doneCount = Math.min(finished ? step + 1 : step, copy.lines.length);
  const trail = copy.lines.slice(Math.max(0, doneCount - 2), doneCount);
  const current = finished ? doneMessage : holding ? copy.holdMessage : copy.lines[step];
  const lineState = finished ? "done" : holding ? "hold" : "working";

  return (
    <section className="analysis-card w-full max-w-md rounded-3xl px-8 pb-7 pt-9 text-center" data-state={lineState}>
      <div aria-hidden="true" className="analysis-aura" />
      <div aria-hidden="true" className="analysis-grid" />

      <div
        aria-label={`${eyebrow} progress`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={0}
        className="analysis-ring mx-auto"
        data-state={finished ? "done" : "working"}
        ref={ringRef}
        role="progressbar"
        style={{ height: SIZE, width: SIZE }}
      >
        <div aria-hidden="true" className="analysis-sweep" />
        <svg aria-hidden="true" className="relative" height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="oklch(90% 0.11 165)" />
              <stop offset="55%" stopColor="oklch(80% 0.15 163)" />
              <stop offset="100%" stopColor="oklch(70% 0.12 182)" />
            </linearGradient>
            <filter height="160%" id={glowId} width="160%" x="-30%" y="-30%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>

          <circle className="analysis-ticks" cx={CENTER} cy={CENTER} fill="none" r={RADIUS + 13} strokeDasharray="1.25 7.1" strokeWidth="5" />
          <circle cx={CENTER} cy={CENTER} fill="none" r={RADIUS} stroke="oklch(100% 0 0 / 0.07)" strokeWidth="7" />

          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            <circle
              className="analysis-arc-glow"
              cx={CENTER}
              cy={CENTER}
              fill="none"
              filter={`url(#${glowId})`}
              r={RADIUS}
              ref={glowArcRef}
              stroke={`url(#${gradientId})`}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE}
              strokeLinecap="round"
              strokeWidth="7"
            />
            <circle
              cx={CENTER}
              cy={CENTER}
              fill="none"
              r={RADIUS}
              ref={arcRef}
              stroke={`url(#${gradientId})`}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE}
              strokeLinecap="round"
              strokeWidth="7"
            />
          </g>

          <g ref={headRef}>
            <circle className="analysis-head-halo" cx={CENTER} cy={CENTER - RADIUS} r="9" />
            <circle cx={CENTER} cy={CENTER - RADIUS} fill="oklch(97% 0.04 165)" r="3.6" />
          </g>
        </svg>

        <div className="absolute inset-0 grid place-items-center">
          <div>
            <p className="analysis-percent">
              <span ref={percentRef}>0</span>
              <span className="analysis-percent-sign">%</span>
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-emerald-200/60">
              {finished ? "Complete" : holding ? "Finishing" : "Analyzing"}
            </p>
          </div>
        </div>
      </div>

      <p className="relative mt-7 text-[10px] font-medium uppercase tracking-[0.18em] text-emerald-300">{eyebrow}</p>

      {copy.context.length > 0 ? (
        <ul aria-label="Your case" className="relative mt-3 flex flex-wrap justify-center gap-1.5">
          {copy.context.map((tag) => (
            <li className="analysis-chip" key={tag}>
              {tag}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative mt-6 min-h-[8.5rem] text-left">
        <ul aria-hidden="true" className="space-y-1.5">
          {trail.map((line, index) => (
            <li
              className="analysis-trail-in flex items-start gap-2 text-[11px] leading-snug text-white/45"
              key={line}
              style={{ opacity: index === trail.length - 1 ? 0.85 : 0.5 }}
            >
              <span className="mt-px shrink-0 text-emerald-300/80">
                <CheckIcon />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div aria-live="polite" className="mt-3">
          <div className="analysis-line-in flex items-start gap-3" key={current}>
            <span aria-hidden="true" className="analysis-live-dot mt-[0.45rem] shrink-0" data-state={lineState}>
              {finished ? <CheckIcon size={10} /> : null}
            </span>
            <p className={`text-[17px] font-medium leading-snug tracking-tight ${lineState === "working" ? "analysis-shimmer" : "text-white/90"}`}>
              {current}
            </p>
          </div>
        </div>
      </div>

      <p className="relative mt-5 border-t border-white/[0.07] pt-4 text-[10px] leading-relaxed text-white/40">{footnote}</p>
    </section>
  );
}
