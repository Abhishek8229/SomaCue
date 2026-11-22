import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/actions/precautions", () => ({ markPrecautionsSeen: vi.fn() }));
vi.mock("@/actions/intake", () => ({ submitIntakeForm: vi.fn() }));
vi.mock("@/hooks/useDictation", () => ({
  useDictation: () => ({ isListening: false, transcript: "", startListening: vi.fn(), stopListening: vi.fn() }),
}));

import { SidebarIntake } from "@/app/workspace/WorkspaceParts";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { PrecautionsCard } from "@/components/workspace/PrecautionsCard";
import { RecoveryTimelineLink } from "@/components/workspace/RecoveryTimelineLink";
import { RECOVERY_EXPORT_PATH, RECOVERY_TIMELINE_HREF, RECOVERY_TIMELINE_ID } from "@/lib/recovery/links";
import { deriveRecoveryEvents, mergeRecoveryEvents, summarizeTrends, type RecoveryTimeline } from "@/lib/recovery/timeline";
import type { DashboardSnapshot } from "@/lib/dashboard/types";
import type { DynamicPrecautions } from "@/lib/precautions/precautions";

const STEPS = [
  { exerciseName: "Glute Bridge", animationTriggerId: "glute_bridge", durationSeconds: 30, voiceCue: "Lift" },
  { exerciseName: "Gentle Cat Cow", animationTriggerId: "cat_cow", durationSeconds: 30, voiceCue: "Round" },
  { exerciseName: "Ankle Pumps", animationTriggerId: "ankle_pumps", durationSeconds: 30, voiceCue: "Pump" },
];
const PHASES = [
  { phase: "Calm", tagline: "Settle the irritated tissue" },
  { phase: "Build", tagline: "Add strength and range" },
];
const planStart = new Date().toISOString();

const snapshot: DashboardSnapshot = {
  user: { name: "Asha Rao", email: "asha@example.com", role: "patient" },
  reports: [
    {
      id: "report-1",
      createdAt: planStart,
      primarySymptoms: "Low back pain",
      scanUrls: [],
      prescriptionUrls: [],
      uncategorizedUrls: [],
      conditionTitle: "Likely lower lumbar disc bulge",
      conditionSummary: "A bulging disc.",
      conditionSource: "symptoms_only",
      requiresInPersonCare: false,
      careReason: null,
      escalation: null,
      plan: { durationMonths: 2, phases: PHASES, steps: STEPS, schedule: { horizonDays: 1, days: [{ dayOffset: 0, status: "active", focus: "Mobility", tagline: "Start gently." }] } },
      planCreatedAt: planStart,
      hasQuiz: true,
    },
  ],
  progress: [],
  painEvents: [],
};

function buildTimeline(): RecoveryTimeline {
  const progress = Array.from({ length: 9 }, (_, index) => {
    const day = String(index + 2).padStart(2, "0");
    return {
      reportId: "report-1",
      dateKey: `2026-11-${day}`,
      completedExercises: ["Glute Bridge"],
      completedAt: new Date(`2026-11-${day}T10:00:00Z`),
      feedback: index === 3 ? "issue" : "relief",
      notes: null,
      discomfortExercises: index === 3 ? ["Glute Bridge"] : [],
      discomfortDetails: index === 3 ? "Pulling in my lower back." : null,
      rescheduledAt: null,
      updatedAt: new Date(`2026-11-${day}T10:00:00Z`),
    };
  });
  const events = mergeRecoveryEvents(
    [
      {
        key: "chat:m1",
        kind: "chat_insight",
        title: "Pain trigger mentioned in chat",
        detail: '"My back hurts when I sit."',
        occurredAt: "2026-11-09T18:00:00.000Z",
        dateKey: null,
        reportId: "report-1",
        meta: null,
      },
    ],
    deriveRecoveryEvents(
      {
        reports: [
          {
            id: "report-1",
            createdAt: new Date("2026-11-01T08:00:00Z"),
            primarySymptoms: "Low back pain",
            conditionTitle: "Likely lower lumbar disc bulge",
            conditionSummary: "A bulging disc.",
            escalatedAt: null,
            escalationReason: null,
            plan: { durationMonths: 2, phases: PHASES, steps: STEPS, startDateKey: "2026-11-01" } as never,
            planCreatedAt: new Date("2026-11-01T08:10:00Z"),
            dynamic: null,
          },
        ],
        progress,
        painEvents: [],
      },
      "2026-11-10",
    ),
  );
  return {
    patient: { name: "Asha Rao", email: "asha@example.com" },
    generatedAt: "2026-11-10T09:00:00.000Z",
    events,
    trends: summarizeTrends(events),
    condition: { title: "Likely lower lumbar disc bulge", summary: "A bulging disc.", symptoms: "Low back pain", startedAt: "2026-11-01T08:00:00.000Z", requiresInPersonCare: false, careReason: null },
    plan: { durationMonths: 2, phases: PHASES, startDateKey: "2026-11-01", dayNumber: 10, weekNumber: 2, phaseName: "Calm" },
    precautions: { permanent: ["Avoid loaded forward bending."], dynamic: ["Keep ranges small."], dynamicBadge: "Week 2 • Active" },
  };
}

function stubBrowser(reduced = false) {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return scrollIntoView;
}

beforeEach(() => {
  window.location.hash = "";
  stubBrowser();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("Recovery Timeline on /dashboard", () => {
  it("shows the section with its id, totals and the journey from the first analysis", () => {
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    const section = document.getElementById(RECOVERY_TIMELINE_ID) as HTMLElement;
    expect(section).toBeInTheDocument();
    expect(section).toHaveAccessibleName("Recovery Timeline");

    const totals = within(screen.getByRole("list", { name: "Recovery totals" }));
    expect(totals.getByText("Sessions done").previousElementSibling).toHaveTextContent("9");
    expect(totals.getByText("Felt better").previousElementSibling).toHaveTextContent("8");
    expect(totals.getByText("More discomfort").previousElementSibling).toHaveTextContent("1");
  });

  it("lists the newest entries first, then everything on request, oldest first if asked", () => {
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    const section = within(document.getElementById(RECOVERY_TIMELINE_ID) as HTMLElement);
    const titles = () => section.getAllByRole("listitem").map((item) => item.textContent ?? "").filter((text) => /after the session|Session completed|analysis|plan|chat|began/i.test(text));

    expect(section.getByText("Pain trigger mentioned in chat")).toBeInTheDocument();
    expect(section.queryByText("First analysis: Likely lower lumbar disc bulge")).not.toBeInTheDocument(); // behind "Show all"

    fireEvent.click(section.getByRole("button", { name: /Show all \d+ entries/ }));
    expect(section.getByText("First analysis: Likely lower lumbar disc bulge")).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();

    fireEvent.click(section.getByRole("button", { name: "Newest first" }));
    expect(section.getByRole("button", { name: "Oldest first" })).toBeInTheDocument();
    expect(titles()[0]).toContain("First analysis");
  });

  it("filters by what the entries are about", () => {
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    const section = within(document.getElementById(RECOVERY_TIMELINE_ID) as HTMLElement);

    fireEvent.click(section.getByRole("button", { name: "Companion chat" }));
    expect(section.getByRole("button", { name: "Companion chat" })).toHaveAttribute("aria-pressed", "true");
    expect(section.getByText("Pain trigger mentioned in chat")).toBeInTheDocument();
    expect(section.queryByText("Session completed")).not.toBeInTheDocument();

    fireEvent.click(section.getByRole("button", { name: "Pain and safety" }));
    expect(section.getByText(/Nothing in this view yet/)).toBeInTheDocument();
  });

  it("offers the export anytime: download a file, or print / save as PDF", () => {
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    const section = within(document.getElementById(RECOVERY_TIMELINE_ID) as HTMLElement);
    const download = section.getByRole("link", { name: "Download report" });
    expect(download.getAttribute("href")).toMatch(new RegExp(`^${RECOVERY_EXPORT_PATH}\\?download=1&tz=-?\\d+$`));
    expect(download).toHaveAttribute("download");
    expect(section.getByRole("button", { name: "Print or save as PDF" })).toBeEnabled();
  });

  it("prints the report in a hidden frame without leaving the dashboard", async () => {
    const html = "<!doctype html><html><body><h1>Recovery Timeline</h1></body></html>";
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(html, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const frames: HTMLIFrameElement[] = [];
    const append = document.body.appendChild.bind(document.body);
    // The frame is captured, not attached, so the test decides when it "loads".
    vi.spyOn(document.body, "appendChild").mockImplementation(((node: Node) => {
      if (node instanceof HTMLIFrameElement) {
        frames.push(node);
        return node;
      }
      return append(node);
    }) as typeof document.body.appendChild);

    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    fireEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));

    await waitFor(() => expect(frames).toHaveLength(1));
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(new RegExp(`^${RECOVERY_EXPORT_PATH}\\?tz=-?\\d+$`));
    expect(frames[0].srcdoc).toBe(html);
    expect(screen.getByRole("button", { name: "Preparing..." })).toBeDisabled();

    const print = vi.fn();
    Object.defineProperty(frames[0], "contentWindow", { value: { focus: vi.fn(), print }, configurable: true });
    await act(async () => {
      frames[0].onload?.(new Event("load"));
    });
    expect(print).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeEnabled());
    vi.unstubAllGlobals();
  });

  it("says so, and keeps the download, when the report cannot be prepared", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    fireEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));
    expect(await screen.findByText(/could not be prepared/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download report" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("is left out when there is no timeline and when there is no intake yet", () => {
    const { rerender } = render(<DashboardView snapshot={snapshot} timeline={null} />);
    expect(document.getElementById(RECOVERY_TIMELINE_ID)).not.toBeInTheDocument();
    rerender(<DashboardView snapshot={{ ...snapshot, reports: [] }} timeline={buildTimeline()} />);
    expect(document.getElementById(RECOVERY_TIMELINE_ID)).not.toBeInTheDocument();
  });
});

describe("arriving from Rehab Studio at /dashboard#recovery-timeline", () => {
  it("scrolls smoothly to the section and moves focus into it", () => {
    const scrollIntoView = stubBrowser(false);
    window.location.hash = `#${RECOVERY_TIMELINE_ID}`;
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    const section = document.getElementById(RECOVERY_TIMELINE_ID) as HTMLElement;
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(section).toHaveFocus();
  });

  it("does not animate for someone who asked for reduced motion", () => {
    const scrollIntoView = stubBrowser(true);
    window.location.hash = `#${RECOVERY_TIMELINE_ID}`;
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("does nothing without the hash, and follows a later hash change", () => {
    const scrollIntoView = stubBrowser(false);
    render(<DashboardView snapshot={snapshot} timeline={buildTimeline()} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    act(() => {
      window.location.hash = `#${RECOVERY_TIMELINE_ID}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("Rehab Studio shortcut", () => {
  it("is a small link that goes straight to the Recovery Timeline section on the Dashboard", () => {
    render(<RecoveryTimelineLink />);
    const link = screen.getByTestId("recovery-timeline-link");
    expect(link).toHaveTextContent("Chronological Recovery Timeline available in Dashboard");
    expect(link).toHaveAttribute("href", "/dashboard#recovery-timeline");
    expect(link.getAttribute("href")).toBe(RECOVERY_TIMELINE_HREF);
    // the hash is the id of the dashboard section
    expect(RECOVERY_TIMELINE_HREF.split("#")[1]).toBe(RECOVERY_TIMELINE_ID);
    // small and unobtrusive: one line of tiny text, with a decorative arrow that screen readers skip
    expect(link.className).toContain("text-[10px]");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("sits at the top of the sidebar, so it is seen without scrolling", () => {
    const dynamic: DynamicPrecautions = {
      items: ["Use small ranges.", "Pause if the pain spreads.", "Rest on flare-up days."],
      badge: "Week 1 • Active",
      kind: "initial",
      updatedAt: "2026-11-19T10:00:00.000Z",
      seenAt: "2026-11-19T10:00:00.000Z",
      weekNumber: 1,
      phaseIndex: 0,
      base: [],
    };
    render(
      <SidebarIntake
        flowError={null}
        flowPhase="ready"
        hideCrossQuestioning
        onError={vi.fn()}
        onPreparing={vi.fn()}
        onRerunAnalysis={vi.fn()}
        onTriageReady={vi.fn()}
        precautions={<PrecautionsCard dynamic={dynamic} permanent={["Avoid loaded forward bending.", "Keep a neutral spine.", "Stop for leg numbness."]} reportId="report-1" />}
        reportsSubmitted
        timelineLink={<RecoveryTimelineLink />}
      />,
    );
    const link = screen.getByTestId("recovery-timeline-link");
    expect(link.parentElement?.firstElementChild).toBe(link);
    expect(link.compareDocumentPosition(screen.getByTestId("precautions-card")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
