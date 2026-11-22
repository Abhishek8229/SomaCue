import { KIND_LABELS, toneOf, type RecoveryEvent, type RecoveryTimeline } from "./timeline";

/*
 * The shareable Recovery Timeline: one self-contained HTML document with its own print styles, made for
 * a doctor or physiotherapist. It opens in any browser, prints cleanly and saves as a PDF from the print
 * dialog. Every value is escaped, because it holds text the patient typed.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${MONTHS[month - 1] ?? "?"} ${day}, ${year}`;
}

/** The viewer's local day key for an instant. `tzOffsetMinutes` is how far the viewer's clock is behind UTC (as `getTimezoneOffset`). */
export function localDayKey(iso: string, tzOffsetMinutes: number): string {
  return new Date(new Date(iso).getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Reads the `tz` query value: whole minutes, within real time zones, otherwise 0 (UTC). */
export function parseTzOffset(value: string | null): number {
  if (!value || !/^-?\d{1,4}$/.test(value)) return 0;
  const minutes = Number(value);
  return Math.abs(minutes) <= 14 * 60 ? minutes : 0;
}

export function eventDay(event: Pick<RecoveryEvent, "dateKey" | "occurredAt">, tzOffsetMinutes: number): string {
  return event.dateKey ?? localDayKey(event.occurredAt, tzOffsetMinutes);
}

const FEEDBACK_LABEL = { relief: "Better", same: "Same", issue: "More discomfort" } as const;

function tag(name: string, text: string, attrs = ""): string {
  return `<${name}${attrs ? ` ${attrs}` : ""}>${escapeHtml(text)}</${name}>`;
}

function bullets(items: readonly string[], empty: string): string {
  return items.length > 0 ? `<ul>${items.map((item) => tag("li", item)).join("")}</ul>` : `<p class="muted">${escapeHtml(empty)}</p>`;
}

function trendRows(timeline: RecoveryTimeline): string {
  const { trends } = timeline;
  const rows: [string, string][] = [
    ["Sessions completed", String(trends.sessionsCompleted)],
    ["Felt better after a session", String(trends.feedback.relief)],
    ["About the same after a session", String(trends.feedback.same)],
    ["More discomfort after a session", String(trends.feedback.issue)],
    ["Pain Override stops", String(trends.painOverrides)],
    ["Missed days", String(trends.missedDays)],
    ["Plan adjustments", String(trends.planAdjustments)],
    ["Updates noted in Companion chat", String(trends.chatInsights)],
  ];
  return rows.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
}

const STYLE = `
:root{--ink:#16201d;--muted:#5a6762;--rule:#d5dcd9;--soft:#f3f6f5;--accent:#0f6b57;--warn:#9a5b00;--alert:#a02525}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:820px;margin:0 auto;padding:32px 24px 56px}
h1{font-size:26px;line-height:1.2;margin:0 0 4px}
h2{font-size:18px;margin:32px 0 10px;padding-bottom:6px;border-bottom:2px solid var(--ink)}
h3{font-size:15px;margin:0}
p{margin:0 0 8px}
ul{margin:0;padding-left:20px}
li{margin:0 0 4px}
.muted{color:var(--muted)}
.meta{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:12px 0 0}
.meta dt{color:var(--muted)}
.meta dd{margin:0}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 8px;border-bottom:1px solid var(--rule);text-align:left;vertical-align:top}
th[scope=row]{font-weight:500;width:70%}
td{font-variant-numeric:tabular-nums}
.callout{border:1px solid var(--rule);border-left:4px solid var(--accent);background:var(--soft);padding:10px 14px;margin:10px 0}
.callout.alert{border-left-color:var(--alert)}
ol.timeline{list-style:none;margin:0;padding:0}
ol.timeline>li{display:grid;grid-template-columns:104px 1fr;gap:4px 14px;padding:10px 0;border-bottom:1px solid var(--rule);break-inside:avoid;page-break-inside:avoid}
.when{color:var(--muted);font-variant-numeric:tabular-nums}
.kind{display:inline-block;margin-left:8px;padding:0 8px;border:1px solid var(--rule);border-radius:999px;color:var(--muted);font-size:12px;font-weight:400}
.kind.good{border-color:var(--accent);color:var(--accent)}
.kind.warn{border-color:var(--warn);color:var(--warn)}
.kind.alert{border-color:var(--alert);color:var(--alert)}
.detail{margin:2px 0 0;color:var(--ink)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.note{margin-top:32px;padding-top:12px;border-top:1px solid var(--rule);color:var(--muted);font-size:13px}
@media (max-width:620px){.cols{grid-template-columns:1fr}ol.timeline>li{grid-template-columns:1fr}}
@media print{main{max-width:none;padding:0}h2{break-after:avoid}.cols{gap:16px}a{color:inherit;text-decoration:none}}
@page{margin:16mm}
`;

/** The whole report as one HTML document. */
export function renderRecoveryReport(timeline: RecoveryTimeline, options: { tzOffsetMinutes?: number } = {}): string {
  const tz = options.tzOffsetMinutes ?? 0;
  const generated = formatKey(localDayKey(timeline.generatedAt, tz));
  const { condition, plan, precautions, trends, events } = timeline;
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const period = firstEvent && lastEvent ? `${formatKey(eventDay(firstEvent, tz))} to ${formatKey(eventDay(lastEvent, tz))}` : "No activity recorded yet";

  const overview = `
<dl class="meta">
  <dt>Patient</dt><dd>${escapeHtml(timeline.patient.name)}</dd>
  <dt>Email</dt><dd>${escapeHtml(timeline.patient.email)}</dd>
  <dt>Recovery started</dt><dd>${condition ? escapeHtml(formatKey(localDayKey(condition.startedAt, tz))) : "Not started yet"}</dd>
  <dt>Period covered</dt><dd>${escapeHtml(period)}</dd>
  <dt>Current plan</dt><dd>${
    plan
      ? escapeHtml(
          `${plan.durationMonths}-month plan, day ${plan.dayNumber} (week ${plan.weekNumber}${plan.phaseName ? `, ${plan.phaseName} phase` : ""})`,
        )
      : "No active plan"
  }</dd>
  <dt>Report created</dt><dd>${escapeHtml(generated)}</dd>
</dl>`;

  const conditionHtml = condition
    ? `
<h3>${escapeHtml(condition.title ?? "Condition not identified yet")}</h3>
${condition.summary ? tag("p", condition.summary) : ""}
<p><strong>Symptoms reported:</strong> ${escapeHtml(condition.symptoms)}</p>
${
  condition.requiresInPersonCare
    ? `<div class="callout alert"><strong>In-person care advised.</strong> ${escapeHtml(condition.careReason ?? "Guided exercises are not advised for this case.")}</div>`
    : ""
}`
    : `<p class="muted">No analysis has been run yet.</p>`;

  const planHtml = plan
    ? `<ol>${plan.phases.map((phase, index) => `<li><strong>Month ${index + 1}, ${escapeHtml(phase.phase)}:</strong> ${escapeHtml(phase.tagline)}</li>`).join("")}</ol>`
    : "";

  const timelineHtml =
    events.length > 0
      ? `<ol class="timeline">${events
          .map((event) => {
            const tone = toneOf(event);
            return `<li><div class="when">${escapeHtml(formatKey(eventDay(event, tz)))}</div><div><h3>${escapeHtml(event.title)}<span class="kind ${tone}">${escapeHtml(KIND_LABELS[event.kind])}</span></h3>${
              event.detail ? `<p class="detail">${escapeHtml(event.detail)}</p>` : ""
            }</div></li>`;
          })
          .join("")}</ol>`
      : `<p class="muted">Nothing has been recorded yet.</p>`;

  const series =
    trends.feedbackSeries.length > 0
      ? `<p class="muted">Session feedback, oldest to newest: ${escapeHtml(
          trends.feedbackSeries.map((point) => `${formatKey(point.dateKey)} ${FEEDBACK_LABEL[point.feedback]}`).join("; "),
        )}.</p>`
      : "";
  const regions =
    trends.painRegions.length > 0
      ? `<p><strong>Where Pain Override was used:</strong> ${escapeHtml(trends.painRegions.map((entry) => `${entry.region} (${entry.count})`).join(", "))}.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(`Recovery Timeline: ${timeline.patient.name}`)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>Recovery Timeline</h1>
<p class="muted">Patient case record from SomaCue</p>
${overview}
</header>

<section aria-labelledby="s-condition">
<h2 id="s-condition">Condition summary</h2>
${conditionHtml}
${plan ? `<h3 style="margin-top:14px">Plan outline</h3>${planHtml}` : ""}
</section>

<section aria-labelledby="s-timeline">
<h2 id="s-timeline">Milestones, oldest first</h2>
${timelineHtml}
</section>

<section aria-labelledby="s-trends">
<h2 id="s-trends">Pain and feedback trends</h2>
<table><tbody>${trendRows(timeline)}</tbody></table>
${regions}
${series}
</section>

<section aria-labelledby="s-precautions">
<h2 id="s-precautions">Current precautions</h2>
${
  precautions
    ? `<div class="cols"><div><h3>Permanent (about the condition)</h3>${bullets(precautions.permanent, "None saved yet.")}</div><div><h3>Dynamic${
        precautions.dynamicBadge ? ` (${escapeHtml(precautions.dynamicBadge.replace(/\s+•\s+|\s{2,}/g, " "))})` : ""
      }</h3>${bullets(precautions.dynamic, "None saved yet.")}</div></div>`
    : `<p class="muted">No precautions saved yet.</p>`
}
</section>

<p class="note">Generated by SomaCue on ${escapeHtml(generated)}. SomaCue is a prototype. The condition summary and precautions are AI-generated guidance, not a medical diagnosis, and exercise ranges are not clinically reviewed. Entries marked Companion chat are the patient's own words. Please confirm everything with a clinician.</p>
</main>
</body>
</html>
`;
}

/** A file name like "recovery-timeline-asha-2026-11-24.html". */
export function reportFileName(name: string, generatedAt: string, tzOffsetMinutes = 0): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "patient";
  return `recovery-timeline-${slug}-${localDayKey(generatedAt, tzOffsetMinutes)}.html`;
}
