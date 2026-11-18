"use client";

import Link from "next/link";
import { useState } from "react";
import { ConditionCard } from "@/components/workspace/ConditionCard";
import { FEEDBACK_OPTIONS } from "@/lib/progress/dailyProgress";
import type {
  DashboardModel,
  HistoryEntry,
  PatientRecord,
  TodayStatus,
  TrendPoint,
  WeekDay,
} from "@/lib/dashboard/types";
import { LocalDate, formatDayKey } from "./LocalDate";
import { CheckMark, CrossMark, DashMark, DotMark, TodayMark } from "./icons";
import styles from "./dashboard.module.css";

const pluralize = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/* Today's prescription */

const STATUS_PILL: Record<TodayStatus, { tone: string; label: (done: number, total: number) => string }> = {
  none: { tone: "neutral", label: () => "No plan yet" },
  locked: { tone: "alert", label: () => "Paused" },
  rest: { tone: "neutral", label: () => "Rest day" },
  pending: { tone: "neutral", label: (_done, total) => `${pluralize(total, "exercise")} to do` },
  partial: { tone: "warn", label: (done, total) => `${done} of ${total} done` },
  completed: { tone: "ok", label: () => "Done for today" },
  stopped: { tone: "alert", label: () => "Stopped with Pain Override" },
};

const WEEK_ICON = {
  completed: <CheckMark />,
  stopped: <CrossMark />,
  today: <TodayMark />,
  upcoming: <DotMark />,
  rest: <DashMark />,
} as const;

const WEEK_LABEL: Record<WeekDay["state"], string> = {
  completed: "completed",
  stopped: "stopped with Pain Override",
  today: "today, not finished",
  upcoming: "upcoming",
  rest: "rest day",
};

function WeekRibbon({ week }: { week: WeekDay[] }) {
  return (
    <div>
      <ol aria-label="Next seven days" className={styles.week}>
        {week.map((day) => (
          <li
            aria-label={`${day.weekday} ${formatDayKey(day.dateKey)}, ${WEEK_LABEL[day.state]}${day.focus ? `, focus: ${day.focus}` : ""}`}
            className={styles.dayCell}
            data-state={day.state}
            key={day.dateKey}
            tabIndex={0}
            title={day.focus}
          >
            <span className={styles.dayWeekday}>{day.isToday ? "Today" : day.weekday}</span>
            <span className={styles.dayNum}>{day.dayOfMonth}</span>
            <span aria-hidden="true" className={styles.dayState}>
              {WEEK_ICON[day.state]}
            </span>
          </li>
        ))}
      </ol>
      <ul aria-hidden="true" className={styles.legend}>
        <li>Check: completed</li>
        <li>Ring: today</li>
        <li>Dot: upcoming</li>
        <li>Dash: rest day</li>
      </ul>
    </div>
  );
}

export function TodayPanel({ model }: { model: DashboardModel }) {
  const { today, week } = model;
  const pill = STATUS_PILL[today.status];
  const total = today.exercises.length;
  const feedback = FEEDBACK_OPTIONS.find((option) => option.value === today.feedback)?.label;

  return (
    <section aria-labelledby="today-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.h2} id="today-title">
            Today&apos;s prescription
          </h2>
          <p className={`${styles.muted} ${styles.small}`}>
            {formatDayKey(today.dateKey, true)}
            {today.focus ? `, ${today.focus}` : ""}
          </p>
        </div>
        <span className={styles.pill} data-tone={pill.tone}>
          {pill.label(today.completedCount, total)}
        </span>
      </div>

      {today.status === "none" ? (
        <p className={styles.notice}>
          Your daily plan appears here once triage is finished. Open the Rehab Studio to continue your intake.
        </p>
      ) : null}
      {today.status === "locked" ? (
        <p className={styles.notice}>
          Guided exercises are paused for this case. Start a new assessment when you are ready.
        </p>
      ) : null}
      {today.status === "rest" ? (
        <p className={styles.notice}>
          Nothing is prescribed today. Rest and let your body recover.
          {today.tagline ? ` ${today.tagline}` : ""}
        </p>
      ) : null}

      {total > 0 && today.status !== "rest" ? (
        <ul className={styles.exercises}>
          {today.exercises.map((exercise) => (
            <li className={styles.exercise} key={exercise.name}>
              <div>
                <p className={styles.exerciseName}>
                  {exercise.name}
                  <span className="visually-hidden">{exercise.done ? " (done)" : " (not done yet)"}</span>
                </p>
                <p className={styles.exerciseMeta}>
                  {exercise.dose ? <span>{exercise.dose}</span> : <span>Follow the spoken cue</span>}
                  {exercise.pacing ? <span>{exercise.pacing}</span> : null}
                </p>
              </div>
              <span className={styles.duration} data-done={exercise.done}>
                {exercise.done ? "Done" : `${exercise.durationSeconds}s guided`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {feedback ? (
        <p className={`${styles.sub} ${styles.small}`}>Today&apos;s check-in: {feedback}.</p>
      ) : null}

      {week.length > 0 ? <WeekRibbon week={week} /> : null}

      <p className={`${styles.muted} ${styles.small}`}>
        Prototype: movement ranges are not clinically reviewed.
      </p>
    </section>
  );
}

/* Condition and evidence */

export function ConditionPanel({ model }: { model: DashboardModel }) {
  const { condition, escalation, evidence, regions } = model;

  return (
    <section aria-labelledby="condition-title" className={styles.panel}>
      <h2 className={styles.h2} id="condition-title">
        Condition and evidence
      </h2>

      {condition ? (
        <div className={`workspace-shell ${styles.zoom}`}>
          <ConditionCard condition={condition} escalation={escalation} />
        </div>
      ) : (
        <p className={styles.notice}>
          Your condition and its evidence basis appear here once triage is finished.
        </p>
      )}

      {evidence ? (
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Clinician notes</dt>
            <dd>{evidence.prescriptions > 0 ? pluralize(evidence.prescriptions, "file") : "None uploaded"}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Imaging scans</dt>
            <dd>{evidence.scans > 0 ? pluralize(evidence.scans, "file") : "None uploaded"}</dd>
          </div>
          {evidence.other > 0 ? (
            <div className={styles.fact}>
              <dt>Other files</dt>
              <dd>{pluralize(evidence.other, "file")}</dd>
            </div>
          ) : null}
          <div className={styles.fact}>
            <dt>Symptom description</dt>
            <dd>{evidence.symptoms ? "Provided" : "Not provided"}</dd>
          </div>
          {regions.length > 0 ? (
            <div className={styles.fact}>
              <dt>Plan targets</dt>
              <dd>{regions.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <Link className={styles.ghost} href="/workspace?new=1">
        Start a new assessment
      </Link>
    </section>
  );
}

/* Adherence */

export function AdherencePanel({ model }: { model: DashboardModel }) {
  const { adherence, program, today } = model;
  const hasSessions = adherence.completedSessions > 0 || adherence.stoppedSessions > 0;

  return (
    <section aria-labelledby="adherence-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.h2} id="adherence-title">
          Adherence and streak
        </h2>
        {adherence.daysSinceStart !== null && program.state === "active" ? (
          <span className={`${styles.muted} ${styles.small}`}>Day {adherence.daysSinceStart + 1} of your plan</span>
        ) : null}
      </div>

      {program.state !== "active" ? (
        <p className={styles.notice}>Adherence appears once your plan is ready and you start sessions.</p>
      ) : !hasSessions ? (
        <p className={styles.notice}>
          {today.status === "rest"
            ? "Today is a rest day. Your first completed session starts your streak."
            : "Your first completed session starts your streak. Tick each exercise in the Rehab Studio, then choose Done for today."}
        </p>
      ) : (
        <>
          <dl className={styles.stats}>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>{adherence.completedSessions === 1 ? "session completed" : "sessions completed"}</dt>
              <dd className={styles.statValue}>{adherence.completedSessions}</dd>
            </div>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>{adherence.currentStreak === 1 ? "day streak" : "day streak"}</dt>
              <dd className={styles.statValue}>{adherence.currentStreak}</dd>
            </div>
            <div className={styles.stat}>
              <dt className={styles.statLabel}>best streak</dt>
              <dd className={styles.statValue}>{adherence.bestStreak}</dd>
            </div>
          </dl>

          <div>
            <ol
              aria-label={`Last 14 days: ${adherence.recentCompleted} completed${adherence.stoppedSessions ? `, ${adherence.stoppedSessions} stopped` : ""}`}
              className={styles.dots}
            >
              {adherence.recent.map((day, index) => (
                <li
                  className={styles.dot}
                  data-state={day.state}
                  data-today={index === adherence.recent.length - 1}
                  key={day.dateKey}
                  title={`${formatDayKey(day.dateKey)}: ${day.state === "none" ? "no session" : day.state}`}
                />
              ))}
            </ol>
            <p className={`${styles.muted} ${styles.small}`}>
              Last 14 days: {adherence.recentCompleted} completed
              {adherence.stoppedSessions > 0 ? `, ${adherence.stoppedSessions} stopped with Pain Override in this plan` : ""}.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/* Check-in trend */

const LEVEL_ROWS: Array<{ level: 1 | 0 | -1; label: string }> = [
  { level: 1, label: "Relief" },
  { level: 0, label: "Same" },
  { level: -1, label: "Discomfort" },
];

const FEEDBACK_LABEL = Object.fromEntries(FEEDBACK_OPTIONS.map((option) => [option.value, option.label]));

function TrendLedger({ points }: { points: TrendPoint[] }) {
  const [selected, setSelected] = useState(points.length - 1);
  const active = points[Math.min(selected, points.length - 1)];

  return (
    <div>
      <div
        aria-label="Check-ins from oldest to newest"
        className={styles.ledger}
        role="group"
        style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {LEVEL_ROWS.map((row) => (
          <RowCells key={row.level} label={row.label} level={row.level} onSelect={setSelected} points={points} selected={selected} />
        ))}
        <span />
        {points.map((point) => (
          <span aria-hidden="true" className={styles.axis} key={point.dateKey}>
            {Number(point.dateKey.slice(8, 10))}
          </span>
        ))}
      </div>
      <p aria-live="polite" className={styles.readout}>
        {formatDayKey(active.dateKey, true)}: {FEEDBACK_LABEL[active.feedback]}
        {active.stopped ? ". You also used Pain Override that day." : "."}
      </p>
    </div>
  );
}

function RowCells({
  label,
  level,
  points,
  selected,
  onSelect,
}: {
  label: string;
  level: 1 | 0 | -1;
  points: TrendPoint[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <>
      <span className={styles.ledgerLabel}>{label}</span>
      {points.map((point, index) =>
        point.level === level ? (
          <button
            aria-label={`${formatDayKey(point.dateKey, true)}: ${FEEDBACK_LABEL[point.feedback]}${point.stopped ? ", with Pain Override" : ""}`}
            aria-pressed={selected === index}
            className={styles.point}
            data-level={point.level}
            data-stopped={point.stopped}
            key={point.dateKey}
            onClick={() => onSelect(index)}
            type="button"
          />
        ) : (
          <span key={point.dateKey} />
        ),
      )}
    </>
  );
}

export function TrendPanel({ model }: { model: DashboardModel }) {
  const { points, counts } = model.trend;

  return (
    <section aria-labelledby="trend-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.h2} id="trend-title">
          How sessions have felt
        </h2>
        {points.length > 0 ? (
          <span className={`${styles.muted} ${styles.small}`}>Latest {pluralize(points.length, "check-in")}</span>
        ) : null}
      </div>

      {points.length === 0 ? (
        <p className={styles.notice}>
          Your check-ins chart here. After a session, choose Done for today and say whether it brought more relief,
          felt about the same, or caused more discomfort.
        </p>
      ) : (
        <>
          <TrendLedger key={points.length} points={points} />
          <dl className={styles.counts}>
            <div>
              <dt className="visually-hidden">More relief</dt>
              <dd>{counts.relief} more relief</dd>
            </div>
            <div>
              <dt className="visually-hidden">About the same</dt>
              <dd>{counts.same} about the same</dd>
            </div>
            <div>
              <dt className="visually-hidden">More discomfort</dt>
              <dd>{counts.issue} more discomfort</dd>
            </div>
            <div>
              <dt className="visually-hidden">Pain Override</dt>
              <dd>{counts.stops} Pain Override</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

/* Records */

type RecordTab = "all" | PatientRecord["category"];

const TABS: Array<{ id: RecordTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "scan", label: "Scans" },
  { id: "prescription", label: "Notes" },
];

export function RecordsPanel({ records }: { records: PatientRecord[] }) {
  const [tab, setTab] = useState<RecordTab>("all");
  const shown = records.filter((record) => tab === "all" || record.category === tab);
  const otherCount = records.filter((record) => record.category === "other").length;

  return (
    <section aria-labelledby="records-title" className={styles.panel}>
      <div className={styles.panelHead}>
        <h2 className={styles.h2} id="records-title">
          Uploaded clinical records
        </h2>
        <div aria-label="Filter records" className={styles.tabs} role="tablist">
          {TABS.map((entry) => (
            <button
              aria-selected={tab === entry.id}
              className={styles.tab}
              key={entry.id}
              onClick={() => setTab(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {records.length === 0 ? (
        <p className={styles.notice}>
          Imaging scans and clinician notes you add during intake are listed here, with the date of the intake.
        </p>
      ) : shown.length === 0 ? (
        <p className={styles.notice}>Nothing in this category yet.</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((record) => (
            <li className={styles.item} key={record.id}>
              <div>
                <p className={styles.itemTitle}>{record.label}</p>
                <p className={styles.itemMeta}>
                  {record.categoryLabel}, {record.fileType}, added <LocalDate iso={record.uploadedOn} />
                </p>
              </div>
              {record.href ? (
                <a className={`${styles.link} ${styles.small}`} href={record.href} rel="noreferrer" target="_blank">
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {otherCount > 0 && tab === "all" ? (
        <p className={`${styles.muted} ${styles.small}`}>
          Earlier uploads were stored before scans and notes were separated.
        </p>
      ) : null}
    </section>
  );
}

/* Triage history */

const OUTCOME_TONE: Record<HistoryEntry["outcome"], string> = {
  plan_active: "ok",
  plan_saved: "neutral",
  in_progress: "warn",
  in_person_care: "alert",
  escalated: "alert",
};

export function HistoryPanel({ history }: { history: HistoryEntry[] }) {
  return (
    <section aria-labelledby="history-title" className={styles.panel} id="history">
      <h2 className={styles.h2} id="history-title">
        Triage history
      </h2>

      {history.length === 0 ? (
        <p className={styles.notice}>Each intake you run is listed here with what it found.</p>
      ) : (
        <ol className={styles.timeline}>
          {history.map((entry) => (
            <li className={styles.event} data-latest={entry.isLatest} key={entry.reportId}>
              <div className={styles.eventTop}>
                <span className={styles.itemTitle}>{entry.title ?? "No condition identified yet"}</span>
                <span className={styles.pill} data-tone={OUTCOME_TONE[entry.outcome]}>
                  {entry.outcomeLabel}
                </span>
              </div>
              <p className={styles.itemMeta}>
                <LocalDate iso={entry.createdAt} />
                {entry.sourceLabel ? `, ${entry.sourceLabel.replace("Derived from ", "from ")}` : ""}
                {entry.fileCount > 0 ? `, ${pluralize(entry.fileCount, "file")}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
