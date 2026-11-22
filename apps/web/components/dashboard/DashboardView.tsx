"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { buildDashboardModel } from "@/lib/dashboard/model";
import type { DashboardModel, DashboardSnapshot, GuardrailMeter } from "@/lib/dashboard/types";
import { useLocalToday, useLocalUtcOffset } from "@/lib/use-today";
import { LocalDate } from "./LocalDate";
import { ArrowRight, Shield } from "./icons";
import type { RecoveryTimeline } from "@/lib/recovery/timeline";
import { AdherencePanel, ConditionPanel, HistoryPanel, RecordsPanel, TodayPanel, TrendPanel } from "./panels";
import { RecoveryTimelinePanel } from "./RecoveryTimelinePanel";
import styles from "./dashboard.module.css";

function programContext(program: DashboardModel["program"]) {
  switch (program.state) {
    case "active":
      return (
        <>
          <span className={styles.contextPhase}>
            Month {program.month} of {program.durationMonths}
            {program.phaseName ? `: ${program.phaseName}` : ""}
          </span>
          <span>Day {program.dayNumber} of your plan</span>
        </>
      );
    case "intake":
      return (
        <span>
          Intake started {program.startedOn ? <LocalDate iso={program.startedOn} /> : null}. Triage is not finished.
        </span>
      );
    case "locked":
      return <span>Guided exercises are paused for in-person care.</span>;
    default:
      return null;
  }
}

function meterTone(meter: GuardrailMeter) {
  if (meter.value >= meter.limit) return "max";
  return meter.value > 0 ? "true" : "false";
}

function GuardrailBand({ model }: { model: DashboardModel }) {
  const { guardrail } = model;
  return (
    <section aria-labelledby="guard-title" className={styles.guard} data-state={guardrail.state}>
      <div>
        <h2 className={styles.guardTitle} id="guard-title">
          <Shield />
          {guardrail.title}
        </h2>
        <p className={styles.guardDetail}>{guardrail.detail}</p>
        {guardrail.evidence.length > 0 ? (
          <ul className={styles.guardEvidence}>
            {guardrail.evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {guardrail.meters.length > 0 ? (
        <ul aria-label="Safety rule progress" className={styles.meters}>
          {guardrail.meters.map((meter) => (
            <li key={meter.label}>
              <div className={styles.meterTop}>
                <span>{meter.label}</span>
                <span className={styles.meterValue}>
                  {meter.value} of {meter.limit}
                </span>
              </div>
              <div
                aria-label={meter.label}
                aria-valuemax={meter.limit}
                aria-valuemin={0}
                aria-valuenow={meter.value}
                className={styles.meterTrack}
                role="meter"
              >
                <span
                  className={styles.meterFill}
                  data-warn={meterTone(meter)}
                  style={{ transform: `scaleX(${Math.min(1, meter.value / meter.limit)})` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const ONBOARDING = [
  { title: "Add your evidence", note: "Upload scans and clinician notes in separate slots, and describe your symptoms." },
  { title: "Get a sourced assessment", note: "Triage names what it was derived from and screens for red flags first." },
  { title: "Follow a 3D-guided plan", note: "A daily plan of one to twelve months, shown by a figure rep by rep." },
];

function Welcome({ model }: { model: DashboardModel }) {
  return (
    <section aria-labelledby="welcome-title" className={styles.welcome}>
      <div className={styles.welcomeCopy}>
        <h2 className={styles.h1} id="welcome-title">
          Your recovery dashboard starts with one intake.
        </h2>
        <p className={styles.sub}>
          Once you have a plan, this page shows today&apos;s prescription, your streak, how sessions felt, your safety
          status and every record you uploaded.
        </p>
        <ol className={styles.steps}>
          {ONBOARDING.map((step, index) => (
            <li className={styles.step} key={step.title}>
              <span className={styles.stepNum}>{index + 1}</span>
              <span>
                <span className={styles.stepTitle}>{step.title}</span>
                <span className={styles.stepNote}>{step.note}</span>
              </span>
            </li>
          ))}
        </ol>
        <div>
          <Link className={styles.cta} href={model.primaryAction.href}>
            {model.primaryAction.label}
            <ArrowRight />
          </Link>
        </div>
      </div>
      <figure className={styles.bench}>
        <Image
          alt="A 3D figure lying on its back performing the Supine Pelvic Tilt"
          className={styles.benchImage}
          height={357}
          src="/landing/pelvic-hold.webp"
          width={560}
        />
        <figcaption className={styles.benchCaption}>Supine Pelvic Tilt, one of the movements the 3D stage can show.</figcaption>
      </figure>
    </section>
  );
}

export function DashboardView({ snapshot, timeline = null }: { snapshot: DashboardSnapshot; timeline?: RecoveryTimeline | null }) {
  // Today follows the device clock, in the viewer's own time zone.
  const todayKey = useLocalToday();
  const utcOffset = useLocalUtcOffset();
  const model = useMemo(() => buildDashboardModel(snapshot, todayKey, utcOffset), [snapshot, todayKey, utcOffset]);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <h1 className={styles.h1}>
              {model.hasAnyIntake ? `Welcome back, ${model.firstName}.` : `Welcome, ${model.firstName}.`}
            </h1>
            <p className={styles.context}>{programContext(model.program)}</p>
            {model.program.state === "active" && model.program.phaseTagline ? (
              <p className={styles.sub}>{model.program.phaseTagline}</p>
            ) : null}
          </div>
          {model.hasAnyIntake ? (
            <Link className={styles.cta} href={model.primaryAction.href}>
              {model.primaryAction.label}
              <ArrowRight />
            </Link>
          ) : null}
        </header>

        {model.hasAnyIntake ? (
          <>
            {model.skipNotice ? (
              <section aria-label="Skipped day" className={styles.skip} role="status">
                <h2 className={styles.skipTitle}>{model.skipNotice.title}</h2>
                <p className={styles.skipBody}>{model.skipNotice.body}</p>
              </section>
            ) : null}
            <GuardrailBand model={model} />
            <div className={`${styles.row} ${styles.rowTodayCondition}`}>
              <TodayPanel model={model} />
              <ConditionPanel model={model} />
            </div>
            <div className={`${styles.row} ${styles.rowAdherence}`}>
              <AdherencePanel model={model} />
              <TrendPanel model={model} />
            </div>
            {timeline ? <RecoveryTimelinePanel timeline={timeline} /> : null}
            <div className={`${styles.row} ${styles.rowRecords}`}>
              <RecordsPanel records={model.records} />
              <HistoryPanel history={model.history} />
            </div>
          </>
        ) : (
          <Welcome model={model} />
        )}

        <p className={styles.disclosure}>
          SomaCue is a prototype. AI-generated assessments are not medical diagnoses, so confirm them with a clinician,
          and movement ranges are not clinically reviewed. SomaCue is not an emergency service: for sudden severe pain,
          chest pain, or loss of bladder or bowel control, get urgent medical care now.
        </p>
      </div>
    </main>
  );
}
