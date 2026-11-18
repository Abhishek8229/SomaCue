// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDashboardModel, daysBetween, shiftDateKey } from "@/lib/dashboard/model";
import type {
  DashboardProgressRow,
  DashboardReport,
  DashboardSnapshot,
} from "@/lib/dashboard/types";
import type { Escalation } from "@/lib/clinical/assessment";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";

const TODAY = "2026-11-18";

const step = (exerciseName: string, id: string) => ({
  exerciseName,
  animationTriggerId: id,
  durationSeconds: 60,
  voiceCue: `Cue for ${exerciseName}`,
});

const PLAN: StoredTreatmentPlan = {
  durationMonths: 3,
  phases: [
    { phase: "Calm and mobilise", tagline: "Gentle range first." },
    { phase: "Build control", tagline: "Add steady holds." },
    { phase: "Return to load", tagline: "Practise daily movements." },
  ],
  steps: [
    step("Supine Pelvic Tilt", "pelvic_tilt"),
    step("Glute Bridge", "glute_bridge"),
    step("Bird Dog", "bird_dog"),
  ],
  schedule: {
    horizonDays: 7,
    days: [
      { dayOffset: 0, status: "active", focus: "Mobility", tagline: "Start gently." },
      { dayOffset: 1, status: "upcoming", focus: "Control", tagline: "Hold steady." },
      { dayOffset: 2, status: "upcoming", focus: "Control", tagline: "Hold steady." },
      { dayOffset: 3, status: "rest", focus: "Recovery", tagline: "Pause." },
      { dayOffset: 4, status: "upcoming", focus: "Control", tagline: "Hold steady." },
      { dayOffset: 5, status: "upcoming", focus: "Control", tagline: "Hold steady." },
      { dayOffset: 6, status: "rest", focus: "Recovery", tagline: "Pause." },
    ],
  },
};

function report(overrides: Partial<DashboardReport> = {}): DashboardReport {
  return {
    id: "report-1",
    createdAt: "2026-11-10T09:00:00.000Z",
    primarySymptoms: "Low back pain after long walks.",
    scanUrls: ["/uploads/aaaaaaaa-0000-4000-8000-000000000001.pdf"],
    prescriptionUrls: [],
    uncategorizedUrls: [],
    conditionTitle: "Likely lower lumbar disc bulge",
    conditionSummary: "Scans and symptoms point to a bulging disc.",
    conditionSource: "scans_and_symptoms",
    requiresInPersonCare: false,
    careReason: null,
    escalation: null,
    plan: PLAN,
    planCreatedAt: "2026-11-18T03:30:00.000Z",
    hasQuiz: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    user: { name: "Asha Rao", email: "asha@example.com", role: "patient" },
    reports: [report()],
    progress: [],
    painEvents: [],
    ...overrides,
  };
}

const row = (dateKey: string, patch: Partial<DashboardProgressRow> = {}): DashboardProgressRow => ({
  dateKey,
  completedExercises: [],
  completed: false,
  feedback: null,
  stopped: false,
  ...patch,
});

const ALL = ["Supine Pelvic Tilt", "Glute Bridge", "Bird Dog"];

describe("date helpers", () => {
  it("shifts day keys across month and year ends", () => {
    expect(shiftDateKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDateKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2026-11-10", "2026-11-18")).toBe(8);
  });
});

describe("a new patient with no intake", () => {
  const model = buildDashboardModel(snapshot({ reports: [] }), TODAY);

  it("has no program and points to the first intake", () => {
    expect(model.hasAnyIntake).toBe(false);
    expect(model.program.state).toBe("none");
    expect(model.primaryAction).toEqual({ href: "/workspace", label: "Start First Intake" });
    expect(model.firstName).toBe("Asha");
  });

  it("produces no records, history, schedule or numbers to chart", () => {
    expect(model.records).toEqual([]);
    expect(model.history).toEqual([]);
    expect(model.week).toEqual([]);
    expect(model.condition).toBeNull();
    expect(model.evidence).toBeNull();
    expect(model.today.status).toBe("none");
    expect(model.adherence.completedSessions).toBe(0);
    expect(model.adherence.daysSinceStart).toBeNull();
    expect(model.trend.points).toEqual([]);
    expect(model.guardrail.state).toBe("standard");
  });
});

describe("an intake whose triage is not finished", () => {
  const model = buildDashboardModel(
    snapshot({ reports: [report({ plan: null, planCreatedAt: null, conditionTitle: null, conditionSummary: null, conditionSource: null })] }),
    TODAY,
  );

  it("asks the patient to finish the intake", () => {
    expect(model.program.state).toBe("intake");
    expect(model.primaryAction.label).toBe("Finish Your Intake");
    expect(model.today.status).toBe("none");
    expect(model.condition).toBeNull();
    expect(model.history[0]).toMatchObject({ outcome: "in_progress", outcomeLabel: "Triage not finished", title: null });
  });
});

describe("an active plan without any check-ins yet", () => {
  const model = buildDashboardModel(snapshot(), TODAY);

  it("reports the month, phase and day of the program", () => {
    expect(model.program).toMatchObject({
      state: "active",
      durationMonths: 3,
      month: 1,
      phaseName: "Calm and mobilise",
      dayNumber: 1,
    });
    expect(model.primaryAction.label).toBe("Continue Today's Session");
  });

  it("lists today's exercises with dose and pacing from the movement data", () => {
    expect(model.today.status).toBe("pending");
    expect(model.today.focus).toBe("Mobility");
    const tilt = model.today.exercises[0];
    expect(tilt).toMatchObject({ name: "Supine Pelvic Tilt", done: false, durationSeconds: 60 });
    expect(tilt.dose).toBe("1 set of 10 reps");
    expect(tilt.pacing).toBe("2s up, 3s hold, 2s down");
  });

  it("builds a seven-day strip starting today", () => {
    expect(model.week.map((day) => day.state)).toEqual([
      "today",
      "upcoming",
      "upcoming",
      "rest",
      "upcoming",
      "upcoming",
      "rest",
    ]);
    expect(model.week[0]).toMatchObject({ dateKey: TODAY, isToday: true, weekday: "Wed", dayOfMonth: 18 });
    expect(model.week[6].dateKey).toBe("2026-11-24");
  });

  it("shows no streak or trend until sessions exist", () => {
    expect(model.adherence).toMatchObject({ completedSessions: 0, currentStreak: 0, bestStreak: 0, daysSinceStart: 0 });
    expect(model.skipNotice).toBeNull();
    expect(model.trend.points).toEqual([]);
    expect(model.guardrail.state).toBe("standard");
    expect(model.guardrail.meters.map((meter) => meter.value)).toEqual([0, 0]);
  });

  it("collects the target regions and evidence basis", () => {
    expect(model.regions).toEqual(expect.arrayContaining(["Lower back", "Pelvis"]));
    expect(model.evidence).toEqual({ scans: 1, prescriptions: 0, other: 0, symptoms: true });
    expect(model.condition?.source).toBe("scans_and_symptoms");
  });
});

describe("an active plan with check-ins", () => {
  const progress = [
    row("2026-11-12", { completed: true, completedExercises: ALL, feedback: "same" }),
    row("2026-11-13", { completed: true, completedExercises: ALL, feedback: "relief" }),
    row("2026-11-14", { completed: true, completedExercises: ALL, feedback: "relief" }),
    row("2026-11-16", { completed: true, completedExercises: ALL, feedback: "issue" }),
    row("2026-11-17", { completed: true, completedExercises: ALL, feedback: "relief" }),
    row(TODAY, { completedExercises: ["supine pelvic tilt"] }),
  ];
  const model = buildDashboardModel(snapshot({ progress }), TODAY);

  it("counts completed sessions and the streak that is still alive", () => {
    expect(model.adherence.completedSessions).toBe(5);
    // Today is not finished, so the streak counts back from yesterday: 17 and 16.
    expect(model.adherence.currentStreak).toBe(2);
    expect(model.adherence.bestStreak).toBe(3);
    expect(model.adherence.recentCompleted).toBe(5);
    expect(model.adherence.recent).toHaveLength(14);
    expect(model.adherence.recent.at(-1)).toEqual({ dateKey: TODAY, state: "none" });
  });

  it("marks today as partly done by matching exercise names loosely", () => {
    expect(model.today.status).toBe("partial");
    expect(model.today.completedCount).toBe(1);
    expect(model.today.exercises.map((exercise) => exercise.done)).toEqual([true, false, false]);
  });

  it("plots check-ins oldest to newest with counts", () => {
    expect(model.trend.points.map((point) => point.level)).toEqual([0, 1, 1, -1, 1]);
    expect(model.trend.counts).toEqual({ relief: 3, same: 1, issue: 1, stops: 0 });
  });

  it("extends the streak once today is completed", () => {
    const done = buildDashboardModel(
      snapshot({ progress: [...progress.slice(0, -1), row(TODAY, { completed: true, completedExercises: ALL })] }),
      TODAY,
    );
    expect(done.today.status).toBe("completed");
    expect(done.adherence.currentStreak).toBe(3);
    expect(done.week[0].state).toBe("completed");
    expect(done.primaryAction.label).toBe("Review Today's Session");
  });

  it("keeps only the latest 14 check-ins", () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      row(shiftDateKey("2026-10-01", index), { completed: true, feedback: "same" }),
    );
    const trimmed = buildDashboardModel(snapshot({ progress: many }), TODAY);
    expect(trimmed.trend.points).toHaveLength(14);
    expect(trimmed.trend.counts.same).toBe(20);
    expect(trimmed.trend.points[0].dateKey).toBe(shiftDateKey("2026-10-01", 6));
  });
});

describe("rest days and Pain Override", () => {
  it("shows a rest day when today's schedule entry is rest", () => {
    const rest: StoredTreatmentPlan = {
      ...PLAN,
      schedule: { horizonDays: 1, days: [{ dayOffset: 0, status: "rest", focus: "Recovery", tagline: "Pause." }] },
    };
    const model = buildDashboardModel(snapshot({ reports: [report({ plan: rest })] }), TODAY);
    expect(model.today.status).toBe("rest");
    expect(model.today.exercises).toEqual([]);
    expect(model.primaryAction.label).toBe("Open Rehab Studio");
    expect(model.week[0].state).toBe("rest");
  });

  it("flags a Pain Override from today as a hold and counts it against the safety rule", () => {
    const model = buildDashboardModel(
      snapshot({
        progress: [row(TODAY, { stopped: true })],
        painEvents: [{ dateKey: TODAY, painType: "sharp_pain", regions: ["lumbar"], exerciseNames: ["Bird Dog"] }],
      }),
      TODAY,
    );
    expect(model.today.status).toBe("stopped");
    expect(model.week[0].state).toBe("stopped");
    expect(model.guardrail.state).toBe("hold");
    expect(model.guardrail.detail).toContain("lower back");
    expect(model.guardrail.meters[0]).toMatchObject({ value: 1, limit: 2 });
    expect(model.adherence.stoppedSessions).toBe(1);
    expect(model.adherence.recent.at(-1)?.state).toBe("stopped");
    expect(model.trend.counts.stops).toBe(1);
  });

  it("returns to standard progression once the hold is older than a day", () => {
    const model = buildDashboardModel(
      snapshot({
        progress: [row("2026-11-14", { stopped: true })],
        painEvents: [{ dateKey: "2026-11-14", painType: "sharp_pain", regions: [], exerciseNames: [] }],
      }),
      TODAY,
    );
    expect(model.guardrail.state).toBe("standard");
    expect(model.guardrail.meters[0].value).toBe(1);
  });

  it("counts consecutive worsening sessions toward the three-in-a-row rule", () => {
    const model = buildDashboardModel(
      snapshot({
        progress: [
          row("2026-11-14", { feedback: "relief" }),
          row("2026-11-15", { feedback: "issue" }),
          row("2026-11-16", { feedback: "issue" }),
        ],
      }),
      TODAY,
    );
    expect(model.guardrail.meters[1]).toMatchObject({ value: 2, limit: 3 });
  });
});

describe("an escalated case", () => {
  const escalation: Escalation = {
    kind: "progress",
    reason: "Your sessions show your symptoms are not improving.",
    evidence: ["Pain Override was used on 2 separate days in the last 14 days."],
    escalatedAt: "2026-11-17T10:00:00.000Z",
  };
  const model = buildDashboardModel(snapshot({ reports: [report({ escalation })] }), TODAY);

  it("pauses today's session and surfaces the advisory", () => {
    expect(model.program.state).toBe("locked");
    expect(model.today.status).toBe("locked");
    expect(model.week).toEqual([]);
    expect(model.primaryAction.label).toBe("Review Safety Notice");
    expect(model.guardrail).toMatchObject({
      state: "escalated",
      title: "Guided exercises paused",
      evidence: escalation.evidence,
    });
    expect(model.history[0]).toMatchObject({ outcome: "escalated" });
  });

  it("treats a triage verdict of in-person care as escalated even before a lock is stored", () => {
    const flagged = buildDashboardModel(
      snapshot({ reports: [report({ requiresInPersonCare: true, careReason: "Possible fracture.", plan: null, planCreatedAt: null })] }),
      TODAY,
    );
    expect(flagged.guardrail).toMatchObject({ state: "escalated", detail: "Possible fracture." });
    expect(flagged.history[0].outcome).toBe("in_person_care");
  });
});

describe("records and triage history", () => {
  const older = report({
    id: "report-0",
    createdAt: "2026-10-01T08:00:00.000Z",
    scanUrls: [],
    prescriptionUrls: [],
    uncategorizedUrls: ["https://account.blob.core.windows.net/patient-scans/old.PDF"],
    plan: null,
    planCreatedAt: null,
    conditionTitle: "Patellofemoral pain syndrome",
    conditionSource: "symptoms_only",
  });
  const latest = report({
    scanUrls: ["/uploads/a.jpg", "/uploads/b.png"],
    prescriptionUrls: ["/uploads/c.pdf"],
    conditionSource: "reports_and_scans",
  });
  const model = buildDashboardModel(snapshot({ reports: [latest, older] }), TODAY);

  it("lists every uploaded file with category, type and the intake date", () => {
    expect(model.records.map((record) => `${record.label}|${record.category}|${record.fileType}`)).toEqual([
      "Clinician note 1|prescription|PDF",
      "Scan 1|scan|JPG",
      "Scan 2|scan|PNG",
      "Report file 1|other|PDF",
    ]);
    expect(model.records[0].uploadedOn).toBe(latest.createdAt);
    expect(model.records[3].uploadedOn).toBe(older.createdAt);
  });

  it("only links files this server stores itself", () => {
    expect(model.records[0].href).toBe("/uploads/c.pdf");
    expect(model.records[3].href).toBeNull();
  });

  it("describes each past triage run", () => {
    expect(model.history).toHaveLength(2);
    expect(model.history[0]).toMatchObject({
      isLatest: true,
      outcome: "plan_active",
      outcomeLabel: "Active plan (3 months)",
      sourceLabel: "Derived from medical reports & scans",
      fileCount: 3,
    });
    expect(model.history[1]).toMatchObject({
      isLatest: false,
      outcome: "in_progress",
      title: "Patellofemoral pain syndrome",
      sourceLabel: "Derived from symptom description only",
      fileCount: 1,
    });
  });
});

describe("program month", () => {
  const plan = (planCreatedAt: string) => snapshot({ reports: [report({ planCreatedAt })] });

  it("moves to the next month every 30 days and stops at the plan length", () => {
    expect(buildDashboardModel(plan("2026-10-18T00:00:00.000Z"), TODAY).program).toMatchObject({ month: 2, phaseName: "Build control" });
    expect(buildDashboardModel(plan("2026-01-01T00:00:00.000Z"), TODAY).program).toMatchObject({ month: 3, phaseName: "Return to load" });
  });
});

describe("viewer time zone", () => {
  it("starts the plan on the viewer's own calendar day", () => {
    // Saved 21:30 UTC on 17 Nov, which is 03:00 on 18 Nov for a viewer in India (UTC+5:30).
    const late = snapshot({ reports: [report({ planCreatedAt: "2026-11-17T21:30:00.000Z" })] });
    expect(buildDashboardModel(late, TODAY, 0).program.dayNumber).toBe(2);
    expect(buildDashboardModel(late, TODAY, -330).program.dayNumber).toBe(1);
    expect(buildDashboardModel(late, TODAY, -330).adherence.daysSinceStart).toBe(0);
  });

  it("handles a viewer west of UTC", () => {
    // 02:00 UTC on 18 Nov is still 17 Nov evening in New York (UTC-5, offset +300).
    const early = snapshot({ reports: [report({ planCreatedAt: "2026-11-18T02:00:00.000Z" })] });
    expect(buildDashboardModel(early, TODAY, 300).program.dayNumber).toBe(2);
    expect(buildDashboardModel(early, TODAY, 0).program.dayNumber).toBe(1);
  });
});

describe("syncing to the calendar", () => {
  const startedYesterday = (progress: DashboardProgressRow[] = []) =>
    snapshot({ reports: [report({ planCreatedAt: "2026-11-17T09:00:00.000Z" })], progress });

  it("counts the analysis day as Day 1 and today as the next day", () => {
    const model = buildDashboardModel(startedYesterday([row("2026-11-17", { completedExercises: ["Supine Pelvic Tilt"] })]), TODAY);
    expect(model.program.dayNumber).toBe(2);
    expect(model.adherence.daysSinceStart).toBe(1);
    expect(model.skipNotice).toBeNull();
    // Day 1 was worked, so today is the next day of the plan.
    expect(model.today.focus).toBe("Control");
  });

  it("alerts that the day was skipped and repeats the missed session today", () => {
    const model = buildDashboardModel(startedYesterday(), TODAY);
    expect(model.program.dayNumber).toBe(2);
    expect(model.skipNotice).toEqual({
      title: "You skipped Nov 17",
      body: "No exercises were logged. Your plan moved forward one day, so today repeats the session you missed.",
    });
    expect(model.today.focus).toBe("Mobility");
    expect(model.today.status).toBe("pending");
    expect(model.week.map((day) => day.focus)).toEqual([
      "Mobility",
      "Control",
      "Control",
      "Recovery",
      "Control",
      "Control",
      "Recovery",
    ]);
    expect(model.week[0]).toMatchObject({ dateKey: TODAY, state: "today" });
  });

  it("does not show the alert once it has been dismissed", () => {
    const dismissed = report({
      planCreatedAt: "2026-11-17T09:00:00.000Z",
      plan: {
        ...PLAN,
        startDateKey: "2026-11-17",
        scheduleAnchor: TODAY,
        skipNotice: { dateKeys: ["2026-11-17"], shiftedDays: 1, noticedOn: TODAY, dismissed: true },
      },
    });
    expect(buildDashboardModel(snapshot({ reports: [dismissed] }), TODAY).skipNotice).toBeNull();
  });

  it("treats a stopped session as attempted, not skipped", () => {
    const model = buildDashboardModel(startedYesterday([row("2026-11-17", { stopped: true })]), TODAY);
    expect(model.skipNotice).toBeNull();
  });

  it("shows no alert for a new patient or an escalated case", () => {
    expect(buildDashboardModel(snapshot({ reports: [] }), TODAY).skipNotice).toBeNull();
    const escalation: Escalation = { kind: "progress", reason: "r", evidence: [], escalatedAt: "2026-11-17T10:00:00.000Z" };
    const locked = snapshot({ reports: [report({ planCreatedAt: "2026-11-10T09:00:00.000Z", escalation })] });
    expect(buildDashboardModel(locked, TODAY).skipNotice).toBeNull();
  });
});