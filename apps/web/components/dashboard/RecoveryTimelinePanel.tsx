"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RECOVERY_EXPORT_PATH, RECOVERY_TIMELINE_ID } from "@/lib/recovery/links";
import { KIND_LABELS, toneOf, type RecoveryEvent, type RecoveryKind, type RecoveryTimeline } from "@/lib/recovery/timeline";
import { useLocalUtcOffset } from "@/lib/use-today";
import { LocalDate, formatDayKey } from "./LocalDate";
import styles from "./dashboard.module.css";

/** How many entries show before "Show all". The newest come first, so the page stays short for a long recovery. */
const PREVIEW_COUNT = 8;

type FilterId = "all" | "sessions" | "safety" | "plan" | "chat";

const FILTERS: { id: FilterId; label: string; kinds: readonly RecoveryKind[] | null }[] = [
  { id: "all", label: "All", kinds: null },
  { id: "sessions", label: "Sessions and feedback", kinds: ["session", "feedback", "missed_day"] },
  { id: "safety", label: "Pain and safety", kinds: ["pain_override", "plan_adjusted", "precaution", "escalation"] },
  { id: "plan", label: "Plan and progress", kinds: ["analysis", "plan", "week"] },
  { id: "chat", label: "Companion chat", kinds: ["chat_insight"] },
];

function EventDate({ event }: { event: RecoveryEvent }) {
  return event.dateKey ? <time dateTime={event.dateKey}>{formatDayKey(event.dateKey, true)}</time> : <LocalDate iso={event.occurredAt} />;
}

type PrintState = "idle" | "preparing" | "error";

/** Prints the report through a hidden frame, so the patient never leaves the dashboard. Save as PDF from the print dialog. */
async function printReport(tzOffsetMinutes: number): Promise<void> {
  const response = await fetch(`${RECOVERY_EXPORT_PATH}?tz=${tzOffsetMinutes}`, { cache: "no-store" });
  if (!response.ok) throw new Error("export failed");
  const html = await response.text();

  await new Promise<void>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;inset-inline-end:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error("print failed"));
      }
      window.setTimeout(() => frame.remove(), 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export function RecoveryTimelinePanel({ timeline }: { timeline: RecoveryTimeline }) {
  const sectionRef = useRef<HTMLElement>(null);
  const tzOffset = useLocalUtcOffset();
  const [filter, setFilter] = useState<FilterId>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [print, setPrint] = useState<PrintState>("idle");

  // Arriving from the Rehab Studio shortcut (/dashboard#recovery-timeline): scroll to the section and
  // move focus into it, so a keyboard or screen reader user lands here too.
  useEffect(() => {
    const focusIfTargeted = () => {
      if (window.location.hash !== `#${RECOVERY_TIMELINE_ID}`) return;
      const section = sectionRef.current;
      if (!section) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      section.focus({ preventScroll: true });
    };
    focusIfTargeted();
    window.addEventListener("hashchange", focusIfTargeted);
    return () => window.removeEventListener("hashchange", focusIfTargeted);
  }, []);

  const visible = useMemo(() => {
    const kinds = FILTERS.find((entry) => entry.id === filter)?.kinds ?? null;
    const filtered = kinds ? timeline.events.filter((event) => kinds.includes(event.kind)) : [...timeline.events];
    return newestFirst ? filtered.reverse() : filtered;
  }, [timeline.events, filter, newestFirst]);

  const shown = showAll ? visible : visible.slice(0, PREVIEW_COUNT);
  const { trends } = timeline;
  const stats = [
    { label: "Sessions done", value: trends.sessionsCompleted },
    { label: "Felt better", value: trends.feedback.relief },
    { label: "More discomfort", value: trends.feedback.issue },
    { label: "Pain Override stops", value: trends.painOverrides },
    { label: "Missed days", value: trends.missedDays },
  ];

  const onPrint = async () => {
    setPrint("preparing");
    try {
      await printReport(tzOffset);
      setPrint("idle");
    } catch {
      setPrint("error");
    }
  };

  return (
    <section
      aria-labelledby="recovery-timeline-title"
      className={`${styles.panel} ${styles.rtSection}`}
      id={RECOVERY_TIMELINE_ID}
      ref={sectionRef}
      tabIndex={-1}
    >
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.h2} id="recovery-timeline-title">
            Recovery Timeline
          </h2>
          <p className={styles.muted}>Your case record from the first analysis, updated as you recover.</p>
        </div>
        <div className={styles.rtTools}>
          <a
            className={`${styles.ghost} ${styles.rtButton}`}
            download
            href={`${RECOVERY_EXPORT_PATH}?download=1&tz=${tzOffset}`}
          >
            Download report
          </a>
          <button className={`${styles.ghost} ${styles.rtButton}`} disabled={print === "preparing"} onClick={onPrint} type="button">
            {print === "preparing" ? "Preparing..." : "Print or save as PDF"}
          </button>
        </div>
      </div>
      <p aria-live="polite" className={styles.small} role="status">
        {print === "error" ? "The report could not be prepared. Try again, or use Download report." : ""}
      </p>

      <ul aria-label="Recovery totals" className={styles.rtStats}>
        {stats.map((stat) => (
          <li className={styles.rtStat} key={stat.label}>
            <span className={styles.rtStatValue}>{stat.value}</span>
            <span className={styles.rtStatLabel}>{stat.label}</span>
          </li>
        ))}
      </ul>

      <div className={styles.rtControls}>
        <div aria-label="Filter the timeline" className={styles.rtFilters} role="group">
          {FILTERS.map((entry) => (
            <button
              aria-pressed={filter === entry.id}
              className={styles.rtFilter}
              key={entry.id}
              onClick={() => {
                setFilter(entry.id);
                setShowAll(false);
              }}
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button className={styles.rtFilter} onClick={() => setNewestFirst((value) => !value)} type="button">
          {newestFirst ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className={styles.notice}>Nothing in this view yet. It fills in as you complete sessions and report how they felt.</p>
      ) : (
        <ol className={styles.timeline}>
          {shown.map((event) => (
            <li className={styles.event} data-tone={toneOf(event)} key={event.key}>
              <div className={styles.eventTop}>
                <span className={styles.itemTitle}>{event.title}</span>
                <span className={styles.pill} data-tone={toneOf(event) === "good" ? "ok" : toneOf(event) === "info" ? undefined : toneOf(event)}>
                  {KIND_LABELS[event.kind]}
                </span>
              </div>
              <p className={styles.itemMeta}>
                <EventDate event={event} />
              </p>
              {event.detail ? <p className={styles.rtDetail}>{event.detail}</p> : null}
            </li>
          ))}
        </ol>
      )}

      {visible.length > PREVIEW_COUNT ? (
        <button className={`${styles.ghost} ${styles.rtButton}`} onClick={() => setShowAll((value) => !value)} type="button">
          {showAll ? "Show fewer" : `Show all ${visible.length} entries`}
        </button>
      ) : null}
    </section>
  );
}
