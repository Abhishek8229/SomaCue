// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, localDayKey, parseTzOffset, renderRecoveryReport, reportFileName } from "@/lib/recovery/export";
import { deriveRecoveryEvents, mergeRecoveryEvents, summarizeTrends, type RecoveryTimeline } from "@/lib/recovery/timeline";

const STEPS = [
  { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
  { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
  { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
];

function sampleTimeline(extra: Partial<RecoveryTimeline> = {}): RecoveryTimeline {
  const events = mergeRecoveryEvents([], deriveRecoveryEvents(
    {
      reports: [
        {
          id: "report-1",
          createdAt: new Date("2026-11-01T08:00:00Z"),
          primarySymptoms: "Low back pain after lifting",
          conditionTitle: "Likely lower lumbar disc bulge",
          conditionSummary: "A bulging disc in the lower spine.",
          escalatedAt: null,
          escalationReason: null,
          plan: {
            durationMonths: 2,
            phases: [
              { phase: "Calm", tagline: "Settle the irritated tissue" },
              { phase: "Build", tagline: "Add strength and range" },
            ],
            steps: STEPS,
            startDateKey: "2026-11-01",
            skippedDays: ["2026-11-03"],
          } as never,
          planCreatedAt: new Date("2026-11-01T08:10:00Z"),
          dynamic: null,
        },
      ],
      progress: [
        { reportId: "report-1", dateKey: "2026-11-02", completedExercises: ["Glute Bridge"], completedAt: new Date("2026-11-02T10:00:00Z"), feedback: "issue", notes: null, discomfortExercises: ["Glute Bridge"], discomfortDetails: "Pulling in my lower back.", rescheduledAt: null, updatedAt: new Date("2026-11-02T10:00:00Z") },
      ],
      painEvents: [
        { id: "p1", reportId: "report-1", dateKey: "2026-11-05", painType: "sharp_pain", regions: ["lumbar"], exerciseNames: ["Glute Bridge"], details: "Caught as I lifted.", createdAt: new Date("2026-11-05T10:00:00Z"), rescheduledAt: null },
      ],
    },
    "2026-11-10",
  ));
  return {
    patient: { name: "Asha Rao", email: "asha@example.com" },
    generatedAt: "2026-11-10T09:00:00.000Z",
    events,
    trends: summarizeTrends(events),
    condition: {
      title: "Likely lower lumbar disc bulge",
      summary: "A bulging disc in the lower spine.",
      symptoms: "Low back pain after lifting",
      startedAt: "2026-11-01T08:00:00.000Z",
      requiresInPersonCare: false,
      careReason: null,
    },
    plan: {
      durationMonths: 2,
      phases: [
        { phase: "Calm", tagline: "Settle the irritated tissue" },
        { phase: "Build", tagline: "Add strength and range" },
      ],
      startDateKey: "2026-11-01",
      dayNumber: 10,
      weekNumber: 2,
      phaseName: "Calm",
    },
    precautions: {
      permanent: ["Avoid loaded forward bending.", "Keep a neutral spine when lifting."],
      dynamic: ["Pain Override on 2026-11-05: avoid Glute Bridge until it has settled."],
      dynamicBadge: "Updated after Pain Override",
    },
    ...extra,
  };
}

describe("renderRecoveryReport", () => {
  it("has every section a clinician needs, in order", () => {
    const html = renderRecoveryReport(sampleTimeline());
    const order = ["Recovery Timeline", "Condition summary", "Milestones, oldest first", "Pain and feedback trends", "Current precautions"].map((heading) => html.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("gives the patient overview", () => {
    const html = renderRecoveryReport(sampleTimeline());
    expect(html).toContain("Asha Rao");
    expect(html).toContain("asha@example.com");
    expect(html).toContain("Recovery started");
    expect(html).toContain("Nov 1, 2026");
    expect(html).toContain("2-month plan, day 10 (week 2, Calm phase)");
    expect(html).toContain("Report created");
    expect(html).toContain("Nov 10, 2026");
  });

  it("gives the condition summary, symptoms and the plan outline", () => {
    const html = renderRecoveryReport(sampleTimeline());
    expect(html).toContain("Likely lower lumbar disc bulge");
    expect(html).toContain("A bulging disc in the lower spine.");
    expect(html).toContain("Symptoms reported:</strong> Low back pain after lifting");
    expect(html).toContain("Month 2, Build:</strong> Add strength and range");
  });

  it("lists the milestones oldest first with their dates", () => {
    const html = renderRecoveryReport(sampleTimeline());
    const order = ["First analysis: Likely lower lumbar disc bulge", "Treatment plan created", "More discomfort after the session", "Missed day: the plan moved forward", "Pain Override: the session was stopped"].map((text) => html.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    // the session on Nov 2 comes before the missed day on Nov 3 and the stop on Nov 5
    expect(order[2]).toBeLessThan(order[3]);
    expect(order[3]).toBeLessThan(order[4]);
    expect(html).toContain("Nov 5, 2026");
    expect(html).toContain("Discomfort with Glute Bridge. Pulling in my lower back.");
  });

  it("summarises the pain and feedback trends", () => {
    const html = renderRecoveryReport(sampleTimeline());
    expect(html).toMatch(/Sessions completed<\/th><td>1</);
    expect(html).toMatch(/More discomfort after a session<\/th><td>1</);
    expect(html).toMatch(/Pain Override stops<\/th><td>1</);
    expect(html).toMatch(/Missed days<\/th><td>1</);
    expect(html).toContain("Where Pain Override was used:</strong> lumbar (1)");
    expect(html).toContain("Nov 2, 2026 More discomfort");
  });

  it("lists the current permanent and dynamic precautions", () => {
    const html = renderRecoveryReport(sampleTimeline());
    expect(html).toContain("Permanent (about the condition)");
    expect(html).toContain("<li>Avoid loaded forward bending.</li>");
    expect(html).toContain("Dynamic (Updated after Pain Override)");
    expect(html).toContain("avoid Glute Bridge until it has settled.");
  });

  it("is a standalone printable page with no scripts or outside requests", () => {
    const html = renderRecoveryReport(sampleTimeline());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@media print");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)=["']https?:/i);
    expect(html).toContain("not a medical diagnosis");
  });

  it("escapes everything the patient typed", () => {
    const attack = `<img src=x onerror=alert(1)> "quoted" & 'single'`;
    const base = sampleTimeline();
    const html = renderRecoveryReport(
      sampleTimeline({
        patient: { name: attack, email: "a@b.c" },
        condition: { ...base.condition!, symptoms: attack, title: attack, summary: attack },
        events: [{ ...base.events[0], title: attack, detail: attack }],
        precautions: { permanent: [attack], dynamic: [attack], dynamicBadge: attack },
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;quoted&quot; &amp; &#39;single&#39;");
  });

  it("still makes a clean report before there is anything to show", () => {
    const html = renderRecoveryReport(sampleTimeline({ events: [], condition: null, plan: null, precautions: null, trends: summarizeTrends([]) }));
    expect(html).toContain("No analysis has been run yet.");
    expect(html).toContain("Nothing has been recorded yet.");
    expect(html).toContain("No precautions saved yet.");
    expect(html).toContain("No active plan");
  });

  it("flags an in-person care advisory", () => {
    const base = sampleTimeline();
    const html = renderRecoveryReport(
      sampleTimeline({ condition: { ...base.condition!, requiresInPersonCare: true, careReason: "Leg weakness needs an examination." } }),
    );
    expect(html).toContain("In-person care advised.");
    expect(html).toContain("Leg weakness needs an examination.");
  });

  it("reads dates in the patient's own time zone", () => {
    // 22:30 UTC on Nov 9 is already Nov 10 in India (UTC+5:30, so the offset is -330)
    expect(localDayKey("2026-11-09T22:30:00.000Z", -330)).toBe("2026-11-10");
    expect(localDayKey("2026-11-09T22:30:00.000Z", 0)).toBe("2026-11-09");
    const html = renderRecoveryReport(sampleTimeline({ generatedAt: "2026-11-09T22:30:00.000Z" }), { tzOffsetMinutes: -330 });
    expect(html).toContain("Nov 10, 2026");
  });
});

describe("export helpers", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("accepts only real time zone offsets", () => {
    expect(parseTzOffset("-330")).toBe(-330);
    expect(parseTzOffset("300")).toBe(300);
    expect(parseTzOffset(null)).toBe(0);
    expect(parseTzOffset("abc")).toBe(0);
    expect(parseTzOffset("99999")).toBe(0);
    expect(parseTzOffset("1e3")).toBe(0);
  });

  it("names the file safely", () => {
    expect(reportFileName("Asha  Rao!", "2026-11-10T09:00:00.000Z")).toBe("recovery-timeline-asha-rao-2026-11-10.html");
    expect(reportFileName('"><script>', "2026-11-10T09:00:00.000Z")).toBe("recovery-timeline-script-2026-11-10.html");
    expect(reportFileName("%%%", "2026-11-10T09:00:00.000Z")).toBe("recovery-timeline-patient-2026-11-10.html");
  });
});

const auth = vi.hoisted(() => ({ user: null as null | { id: string; name: string; email: string; role: string }, timeline: null as unknown }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => auth.user }));
vi.mock("@/lib/recovery/server", () => ({ getRecoveryTimeline: vi.fn(async () => auth.timeline) }));

describe("GET /api/recovery/export", () => {
  beforeEach(() => {
    auth.user = { id: "patient-1", name: "Asha Rao", email: "asha@example.com", role: "PATIENT" };
    auth.timeline = sampleTimeline();
  });

  it("needs a signed-in patient", async () => {
    auth.user = null;
    const { GET } = await import("@/app/api/recovery/export/route");
    const response = await GET(new Request("http://localhost/api/recovery/export"));
    expect(response.status).toBe(401);
  });

  it("shows the report in the browser, for printing, with locked-down headers", async () => {
    const { GET } = await import("@/app/api/recovery/export/route");
    const response = await GET(new Request("http://localhost/api/recovery/export?tz=-330"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain("Recovery Timeline");
    expect(body).toContain("Asha Rao");
  });

  it("downloads it as a named file", async () => {
    const { GET } = await import("@/app/api/recovery/export/route");
    const response = await GET(new Request("http://localhost/api/recovery/export?download=1&tz=0"));
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="recovery-timeline-asha-rao-2026-11-10.html"');
  });
});
