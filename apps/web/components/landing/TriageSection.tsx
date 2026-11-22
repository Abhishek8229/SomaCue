"use client";

import { useState } from "react";
import { ConditionCard } from "@/components/workspace/ConditionCard";
import {
  deriveConditionSource,
  type DetectedCondition,
} from "@/lib/clinical/assessment";
import styles from "./sections.module.css";

type Case = "rehab" | "care";

const CASES: Record<Case, { label: string; title: string; summary: string; care: boolean; reason: string | null }> = {
  rehab: {
    label: "Suitable for guided rehab",
    title: "Likely lower lumbar disc bulge",
    summary: "Scans and symptoms point to a bulging disc in the lower lumbar spine.",
    care: false,
    reason: null,
  },
  care: {
    label: "Needs in-person care",
    title: "Suspected tibial plateau fracture",
    summary: "Symptoms and imaging notes suggest a possible fracture below the knee.",
    care: true,
    reason: "A possible fracture needs an in-person examination before any exercise.",
  },
};

const LADDER = [
  { key: "prescription", title: "Prescriptions and clinician notes", note: "First" },
  { key: "scan", title: "Imaging scans and symptoms", note: "Second" },
  { key: "symptoms", title: "Symptom description alone", note: "Last" },
] as const;

export function TriageSection() {
  const [scans, setScans] = useState(true);
  const [prescriptions, setPrescriptions] = useState(false);
  const [caseKey, setCaseKey] = useState<Case>("rehab");
  const [complex, setComplex] = useState(false);
  const [months, setMonths] = useState(3);

  const source = deriveConditionSource({
    scans: scans ? ["scan"] : [],
    prescriptions: prescriptions ? ["note"] : [],
    uncategorized: [],
  });
  const sample = CASES[caseKey];
  const condition: DetectedCondition = {
    title: sample.title,
    summary: sample.summary,
    source,
    requiresInPersonCare: sample.care,
    careReason: sample.reason,
  };
  const leading = prescriptions ? 0 : scans ? 1 : 2;

  return (
    <section className={styles.section} id="triage" aria-labelledby="triage-title">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h2 id="triage-title" className={styles.h2}>
            Every assessment names the evidence it came from.
          </h2>
          <p className={styles.lead}>
            The source line comes from the files you uploaded, never from the AI&apos;s own claim.
          </p>
        </header>

        <div className={styles.triage}>
          <div className={styles.triageLeft}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>What you uploaded</legend>
              <label className={styles.toggleRow}>
                <input checked={scans} onChange={(e) => setScans(e.target.checked)} type="checkbox" />
                <span>Imaging scans</span>
              </label>
              <label className={styles.toggleRow}>
                <input checked={prescriptions} onChange={(e) => setPrescriptions(e.target.checked)} type="checkbox" />
                <span>Prescriptions or clinician notes</span>
              </label>
            </fieldset>

            <ol className={styles.ladder} aria-label="Evidence priority">
              {LADDER.map((rung, index) => (
                <li className={styles.rung} data-lead={index === leading} key={rung.key}>
                  <span className={styles.rungNum}>{index + 1}</span>
                  <span>
                    <span className={styles.rungTitle}>{rung.title}</span>
                    <span className={styles.rungNote}>{rung.note}</span>
                  </span>
                </li>
              ))}
            </ol>

            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Safety verdict</legend>
              <div className={styles.seg} role="group" aria-label="Sample case">
                {(Object.keys(CASES) as Case[]).map((key) => (
                  <button
                    aria-pressed={caseKey === key}
                    className={styles.segBtn}
                    key={key}
                    onClick={() => setCaseKey(key)}
                    type="button"
                  >
                    {CASES[key].label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className={styles.triageRight}>
            <div className={`workspace-shell ${styles.cardZoom}`} data-slot="condition-card">
              <ConditionCard condition={condition} escalation={null} />
            </div>
            <p className={styles.sampleNote}>Sample output.</p>
          </div>
        </div>

        <div className={styles.plan}>
          <div className={styles.planCol}>
            <h3 className={styles.h3}>Adaptive cross-questioning</h3>
            <p className={styles.hint}>
              Every answer is screened for red flags before a plan is made.
            </p>
            <div className={styles.seg} role="group" aria-label="Case type">
              <button aria-pressed={!complex} className={styles.segBtn} onClick={() => setComplex(false)} type="button">
                Simple issue
              </button>
              <button aria-pressed={complex} className={styles.segBtn} onClick={() => setComplex(true)} type="button">
                Complex or vague
              </button>
            </div>
            <p className={styles.bigFigure}>
              <span className="num">{complex ? "10 to 12" : "6 to 8"}</span> questions
            </p>
          </div>
          <div className={styles.planCol}>
            <h3 className={styles.h3}>A plan of 1 to 12 months</h3>
            <p className={styles.hint}>
              The AI chooses the length per case, with one phase per month.
            </p>
            <input
              aria-label="Plan length in months"
              className={styles.range}
              max={12}
              min={1}
              onChange={(e) => setMonths(Number(e.target.value))}
              type="range"
              value={months}
            />
            <ol className={styles.months} aria-label={`${months} month plan`}>
              {Array.from({ length: 12 }, (_, i) => (
                <li className={styles.month} data-on={i < months} key={i}>
                  {i + 1}
                </li>
              ))}
            </ol>
            <p className={styles.bigFigure}>
              <span className="num">{months}</span> {months === 1 ? "month" : "months"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
