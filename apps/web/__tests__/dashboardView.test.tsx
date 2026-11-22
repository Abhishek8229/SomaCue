import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { toDateKey } from "@/lib/progress/dailyProgress";
import type { DashboardSnapshot } from "@/lib/dashboard/types";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";

afterEach(() => cleanup());

// The view follows the browser's own day, so build every date relative to it.
const today = toDateKey(new Date());
const dayKey = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return toDateKey(date);
};
const planStart = new Date().toISOString();

const step = (exerciseName: string) => ({
  exerciseName,
  animationTriggerId: exerciseName.toLowerCase().replaceAll(" ", "_"),
  durationSeconds: 60,
  voiceCue: "Cue",
});

const plan: StoredTreatmentPlan = {
  durationMonths: 2,
  phases: [
    { phase: "Calm and mobilise", tagline: "Gentle range first." },
    { phase: "Build control", tagline: "Add steady holds." },
  ],
  steps: [step("Supine Pelvic Tilt"), step("Glute Bridge"), step("Bird Dog")],
  schedule: {
    horizonDays: 2,
    days: [
      { dayOffset: 0, status: "active", focus: "Mobility", tagline: "Start gently." },
      { dayOffset: 1, status: "rest", focus: "Recovery", tagline: "Pause." },
    ],
  },
};

const empty: DashboardSnapshot = {
  user: { name: "Asha Rao", email: "asha@example.com", role: "patient" },
  reports: [],
  progress: [],
  painEvents: [],
};

const populated: DashboardSnapshot = {
  ...empty,
  reports: [
    {
      id: "r1",
      createdAt: planStart,
      primarySymptoms: "Low back pain",
      scanUrls: ["/uploads/scan-one.pdf"],
      prescriptionUrls: ["/uploads/note-one.pdf"],
      uncategorizedUrls: [],
      conditionTitle: "Likely lower lumbar disc bulge",
      conditionSummary: "Scans and symptoms point to a bulging disc.",
      conditionSource: "reports_and_scans",
      requiresInPersonCare: false,
      careReason: null,
      escalation: null,
      plan,
      planCreatedAt: planStart,
      hasQuiz: true,
    },
  ],
  progress: [
    { dateKey: dayKey(-1), completedExercises: [], completed: true, feedback: "relief", stopped: false },
    { dateKey: today, completedExercises: ["Supine Pelvic Tilt"], completed: false, feedback: null, stopped: false },
  ],
  painEvents: [],
};

describe("dashboard for a new patient", () => {
  it("shows an onboarding state, not empty charts", () => {
    render(<DashboardView snapshot={empty} />);

    expect(screen.getByRole("heading", { level: 1, name: "Welcome, Asha." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /starts with one intake/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start First Intake/ })).toHaveAttribute("href", "/workspace");

    expect(screen.queryByText("Adherence and streak")).not.toBeInTheDocument();
    expect(screen.queryByText("How sessions have felt")).not.toBeInTheDocument();
    expect(screen.queryByText("Pain Override hold active")).not.toBeInTheDocument();
  });
});

describe("dashboard with an active plan", () => {
  it("greets the patient and shows the program context and the continue action", () => {
    render(<DashboardView snapshot={populated} />);

    expect(screen.getByRole("heading", { level: 1, name: "Welcome back, Asha." })).toBeInTheDocument();
    expect(screen.getByText("Month 1 of 2: Calm and mobilise")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Continue Today's Session/ })).toHaveAttribute("href", "/workspace");
  });

  it("lists today's exercises with their real completion state and dose", () => {
    render(<DashboardView snapshot={populated} />);

    const prescription = screen.getByRole("region", { name: "Today's prescription" });
    expect(within(prescription).getByText("1 of 3 done")).toBeInTheDocument();
    const rows = within(prescription).getAllByRole("listitem");
    const tilt = rows.find((item) => item.textContent?.includes("Supine Pelvic Tilt"));
    expect(tilt).toHaveTextContent("(done)");
    expect(rows.find((item) => item.textContent?.includes("Glute Bridge"))).toHaveTextContent("(not done yet)");
    expect(within(prescription).getAllByText("1 set of 10 reps").length).toBeGreaterThan(0);
    expect(within(prescription).getByRole("list", { name: "Next seven days" }).children).toHaveLength(2);
    // No selection circles: done exercises say "Done", the rest show their length.
    expect(within(prescription).getByText("Done")).toBeInTheDocument();
    expect(within(prescription).getAllByText("60s guided")).toHaveLength(2);
  });

  it("shows the detected condition with its source and a way to start over", () => {
    render(<DashboardView snapshot={populated} />);

    expect(screen.getByText("Derived from medical reports & scans")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new assessment" })).toHaveAttribute("href", "/workspace?new=1");
    expect(screen.getByText("Standard progression")).toBeInTheDocument();
  });

  it("reports the streak and the check-in readout from the logs", () => {
    render(<DashboardView snapshot={populated} />);

    const adherence = screen.getByRole("region", { name: "Adherence and streak" });
    expect(within(adherence).getByText(/session completed/).parentElement).toHaveTextContent("1");

    const trend = screen.getByRole("region", { name: "How sessions have felt" });
    expect(within(trend).getByText(/More relief\./)).toBeInTheDocument();
  });

  it("filters uploaded records by category", () => {
    render(<DashboardView snapshot={populated} />);

    const records = screen.getByRole("region", { name: "Uploaded clinical records" });
    expect(within(records).getByText("Scan 1")).toBeInTheDocument();
    expect(within(records).getByText("Clinician note 1")).toBeInTheDocument();

    fireEvent.click(within(records).getByRole("tab", { name: "Scans" }));
    expect(within(records).getByText("Scan 1")).toBeInTheDocument();
    expect(within(records).queryByText("Clinician note 1")).not.toBeInTheDocument();

    expect(screen.getByRole("region", { name: "Triage history" })).toHaveTextContent("Likely lower lumbar disc bulge");
  });

  it("shows the safety advisory instead of today's list when the case is escalated", () => {
    const escalated: DashboardSnapshot = {
      ...populated,
      reports: [
        {
          ...populated.reports[0],
          escalation: {
            kind: "progress",
            reason: "Your sessions show your symptoms are not improving.",
            evidence: ["Pain Override was used on 2 separate days in the last 14 days."],
            escalatedAt: planStart,
          },
        },
      ],
    };
    render(<DashboardView snapshot={escalated} />);

    expect(screen.getByText("Guided exercises paused")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review Safety Notice/ })).toBeInTheDocument();
    expect(screen.getByText(/Guided exercises are paused for this case/)).toBeInTheDocument();
  });

  it("alerts when yesterday was skipped and shows the plan moved forward", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const skipped: DashboardSnapshot = {
      ...populated,
      reports: [{ ...populated.reports[0], createdAt: yesterday, planCreatedAt: yesterday }],
      progress: [],
    };
    render(<DashboardView snapshot={skipped} />);

    const alert = screen.getByRole("status", { name: "Skipped day" });
    expect(alert).toHaveTextContent(/You skipped/);
    expect(alert).toHaveTextContent("Your plan moved forward one day");
    expect(screen.getAllByText(/Day 2 of your plan/).length).toBeGreaterThan(0);
  });

  it("shows no skipped-day alert when nothing was missed", () => {
    render(<DashboardView snapshot={populated} />);
    expect(screen.queryByRole("status", { name: "Skipped day" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Day 1 of your plan/).length).toBeGreaterThan(0);
  });
});