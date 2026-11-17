"use client";

import { useMemo, useState } from "react";
import {
  ESCALATION_RULES,
  evaluateProgressEscalation,
  screenRedFlags,
  type PainStop,
  type SessionDay,
} from "@/lib/clinical/assessment";
import styles from "./sections.module.css";

const FLAGS = [
  "Loss of bladder or bowel control",
  "Numbness in the groin or saddle area",
  "Progressive weakness or foot drop",
  "Possible fracture",
  "Possible tendon or ligament rupture",
  "Fever or unexplained weight loss with pain",
  "Chest pain or trouble breathing",
  "Pain after major trauma",
];

const SHORT: Record<string, string> = {
  "Loss of bladder or bowel control": "Bladder or bowel control",
  "Numbness in the groin or saddle area": "Groin or saddle numbness",
  "Progressive weakness or foot drop": "Progressive weakness",
  "Possible fracture": "Possible fracture",
  "Possible tendon or ligament rupture": "Tendon or ligament rupture",
  "Fever or unexplained weight loss with pain": "Fever or weight loss with pain",
  "Chest pain or trouble breathing": "Chest pain or breathing",
  "Pain after major trauma": "Major trauma",
};

const EXAMPLES = [
  "I can't control my bladder",
  "Low back pain, no fever",
];

type DayState = "none" | "relief" | "same" | "issue" | "stop";
const CYCLE: DayState[] = ["none", "relief", "same", "issue", "stop"];
const DAY_LABEL: Record<DayState, string> = {
  none: "No session",
  relief: "More relief",
  same: "About the same",
  issue: "More discomfort",
  stop: "Pain Override",
};
const DAY_SHORT: Record<DayState, string> = { none: "", relief: "Relief", same: "Same", issue: "Worse", stop: "Stop" };

const DAY_COUNT = 14;
const dateKey = (index: number) => `2025-03-${String(index + 1).padStart(2, "0")}`;
const TODAY = dateKey(DAY_COUNT - 1);

const PRESET: DayState[] = Array.from({ length: DAY_COUNT }, () => "none");

function MiniWorkspace({ locked }: { locked: boolean }) {
  return (
    <div className={styles.mini} data-locked={locked} aria-hidden="true">
      <div className={styles.miniBar} />
      <div className={styles.miniBody}>
        <div className={styles.miniRail}>
          <span />
          <span />
          <span />
        </div>
        <div className={styles.miniStage}>
          <span>Lying on the back</span>
        </div>
        <div className={styles.miniRail}>
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export function SafetySection() {
  const [text, setText] = useState("");
  const [days, setDays] = useState<DayState[]>(PRESET);

  const matched = useMemo(() => screenRedFlags(text), [text]);
  const locked = matched.length > 0;

  const progress = useMemo(() => {
    const sessions: SessionDay[] = [];
    const stops: PainStop[] = [];
    days.forEach((state, index) => {
      if (state === "none") return;
      if (state === "stop") stops.push({ dateKey: dateKey(index), painType: "sharp_pain" });
      else sessions.push({ dateKey: dateKey(index), feedback: state });
    });
    return evaluateProgressEscalation(sessions, stops, TODAY);
  }, [days]);

  const evidence = progress?.evidence ?? [];
  const ruleLit = [
    evidence.some((line) => line.startsWith("Pain Override was used")),
    evidence.some((line) => line.startsWith("Your last")),
    evidence.some((line) => line.startsWith("None of your last")),
  ];

  const cycle = (index: number) =>
    setDays((current) =>
      current.map((state, i) => (i === index ? CYCLE[(CYCLE.indexOf(state) + 1) % CYCLE.length] : state)),
    );

  return (
    <section className={styles.section} id="safety" aria-labelledby="safety-title">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h2 id="safety-title" className={styles.h2}>
            When warning signs appear, the whole Rehab Studio locks.
          </h2>
          <p className={styles.lead}>
            Fixed keyword checks run before the AI and point you to in-person care.
          </p>
        </header>

        <div className={styles.safetyGrid}>
          <div className={styles.safetyLeft}>
            <h3 className={styles.h3}>Red-flag gate</h3>
            <p className={styles.hint}>&ldquo;No fever&rdquo; is ignored.</p>
            <textarea
              aria-label="Symptom description"
              className={styles.textarea}
              onChange={(event) => setText(event.target.value)}
              placeholder="Describe your symptoms"
              rows={3}
              value={text}
            />
            <div className={styles.chips}>
              {EXAMPLES.map((example) => (
                <button className={styles.chip} key={example} onClick={() => setText(example)} type="button">
                  {example}
                </button>
              ))}
            </div>
            <ul className={styles.flags} aria-label="The eight red flags">
              {FLAGS.map((flag) => (
                <li className={styles.flag} data-hit={matched.includes(flag)} key={flag}>
                  {SHORT[flag] ?? flag}
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.lockPreview}>
            <MiniWorkspace locked={locked} />
            {locked ? (
              <div className={`escalation-card ${styles.alertCard}`} role="alert">
                <h3 className={styles.alertTitle}>Stop. Please get in-person medical care now</h3>
                <div>
                  <p className={styles.alertLabel}>Warning signs in your intake</p>
                  <ul className={styles.alertList}>
                    {matched.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                </div>
                <p className={styles.alertBody}>
                  Do not continue the exercises. Book an in-person appointment with a doctor or physiotherapist. For
                  severe symptoms, call your local emergency number.
                </p>
                <button className={styles.alertAction} onClick={() => setText("")} type="button">
                  Start a new intake
                </button>
              </div>
            ) : (
              <p className={styles.previewNote}>
                Rehab Studio available. A match blurs the page and shows the alert. Escape cannot dismiss it.
              </p>
            )}
          </div>
        </div>

        <div className={styles.override}>
          <div className={styles.overrideHead}>
            <div>
              <h3 className={styles.h3}>Pain Override and worsening sessions</h3>
              <p className={styles.hint}>
                Click a day to cycle its result.
              </p>
            </div>
            <button className={styles.btnLine} onClick={() => setDays(PRESET)} type="button">
              Clear days
            </button>
          </div>

          <ol className={styles.days} aria-label="Fourteen days">
            {days.map((state, index) => (
              <li key={index}>
                <button
                  aria-label={`Day ${index + 1}: ${DAY_LABEL[state]}. Click to change.`}
                  className={styles.day}
                  data-state={state}
                  onClick={() => cycle(index)}
                  type="button"
                >
                  <span className={`${styles.dayNum} num`}>{index + 1}</span>
                  <span className={styles.dayState}>{DAY_SHORT[state]}</span>
                </button>
              </li>
            ))}
          </ol>

          <ul className={styles.rules}>
            <li className={styles.rule} data-hit={ruleLit[0]}>
              Pain Override on {ESCALATION_RULES.painStopDays} days within {ESCALATION_RULES.painStopWindowDays}
            </li>
            <li className={styles.rule} data-hit={ruleLit[1]}>
              The last {ESCALATION_RULES.consecutiveNegative} sessions all negative
            </li>
            <li className={styles.rule} data-hit={ruleLit[2]}>
              {ESCALATION_RULES.plateauSessions} to {ESCALATION_RULES.plateauWindow} sessions with no relief and 2 or more negative
            </li>
          </ul>

          <p className={styles.verdict} data-locked={progress !== null} role="status">
            {progress ? "Platform locked. Guided exercises stop and the case goes to in-person care." : "No lock. Guided exercises continue."}
          </p>
        </div>

      </div>
    </section>
  );
}