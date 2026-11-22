import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const seen = vi.hoisted(() => ({ markPrecautionsSeen: vi.fn() }));
vi.mock("@/actions/precautions", () => ({ markPrecautionsSeen: seen.markPrecautionsSeen }));
vi.mock("@/actions/intake", () => ({ submitIntakeForm: vi.fn() }));
vi.mock("@/hooks/useDictation", () => ({
  useDictation: () => ({ isListening: false, transcript: "", startListening: vi.fn(), stopListening: vi.fn() }),
}));

import { SidebarIntake } from "@/app/workspace/WorkspaceParts";
import { ConditionCard } from "@/components/workspace/ConditionCard";
import { PrecautionsCard } from "@/components/workspace/PrecautionsCard";
import { legacyPermanentPrecautions, SAFE_DEFAULTS, type DynamicPrecautions } from "@/lib/precautions/precautions";

const PERMANENT = [
  "Avoid loaded forward bending.",
  "Keep a neutral spine when you lift.",
  "Stop and get medical help for leg numbness.",
  "Do not sit for more than 45 minutes at a time.",
];

function dynamic(extra: Partial<DynamicPrecautions> = {}): DynamicPrecautions {
  return {
    items: ["Use small ranges in week 1.", "Pause if the pain spreads down the leg.", "Rest on flare-up days."],
    badge: "Week 1 • Active",
    kind: "initial",
    updatedAt: "2026-11-19T10:00:00.000Z",
    seenAt: "2026-11-19T10:00:00.000Z",
    weekNumber: 1,
    phaseIndex: 0,
    base: [],
    ...extra,
  };
}

beforeEach(() => {
  seen.markPrecautionsSeen.mockReset();
  seen.markPrecautionsSeen.mockResolvedValue({ success: true, seenAt: "2026-11-19T12:00:00.000Z" });
});
afterEach(() => cleanup());

describe("Precautions card", () => {
  it("has the header and the two tabs, Permanent selected first, with 3 to 5 bullets", () => {
    render(<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />);
    const card = screen.getByTestId("precautions-card");
    expect(within(card).getByRole("heading", { name: "Precautions" })).toBeInTheDocument();

    const tabs = within(card).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(["Permanent", "Dynamic"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");

    const bullets = within(within(card).getByRole("tabpanel")).getAllByRole("listitem");
    expect(bullets.map((item) => item.textContent)).toEqual(PERMANENT);
    expect(screen.queryByTestId("precautions-badge")).not.toBeInTheDocument();
  });

  it("switches to the Dynamic bullets with the week badge", () => {
    render(<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Dynamic" }));

    expect(screen.getByRole("tab", { name: "Dynamic" })).toHaveAttribute("aria-selected", "true");
    const bullets = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
    expect(bullets.map((item) => item.textContent)).toEqual(["Use small ranges in week 1.", "Pause if the pain spreads down the leg.", "Rest on flare-up days."]);
    expect(screen.getByTestId("precautions-badge")).toHaveTextContent("Week 1 • Active");
  });

  it("shows why the dynamic list changed in the badge", () => {
    render(<PrecautionsCard dynamic={dynamic({ kind: "pain_override", badge: "Updated after Pain Override", seenAt: null })} permanent={PERMANENT} reportId="report-1" />);
    fireEvent.click(screen.getByRole("tab", { name: /Dynamic/ }));
    expect(screen.getByTestId("precautions-badge")).toHaveTextContent("Updated after Pain Override");
  });

  it("shows no dot for a new plan, and a dot on the Dynamic tab when the list changed since it was seen", () => {
    const { unmount } = render(<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />);
    expect(screen.queryByTestId("precautions-dot")).not.toBeInTheDocument();
    unmount();

    render(<PrecautionsCard dynamic={dynamic({ kind: "feedback", badge: "Updated after feedback", seenAt: null, updatedAt: "2026-11-19T11:00:00.000Z" })} permanent={PERMANENT} reportId="report-1" />);
    const tab = screen.getByRole("tab", { name: /Dynamic/ });
    expect(within(tab).getByTestId("precautions-dot")).toBeInTheDocument();
    expect(tab).toHaveTextContent("(updated)");
  });

  it("treats a list changed after it was last seen as unread", () => {
    render(<PrecautionsCard dynamic={dynamic({ seenAt: "2026-11-19T10:00:00.000Z", updatedAt: "2026-11-19T11:00:00.000Z" })} permanent={PERMANENT} reportId="report-1" />);
    expect(screen.getByTestId("precautions-dot")).toBeInTheDocument();
  });

  it("clears the dot, and tells the server once, when the Dynamic tab is opened", async () => {
    render(<PrecautionsCard dynamic={dynamic({ kind: "feedback", badge: "Updated after feedback", seenAt: null, updatedAt: "2026-11-19T11:00:00.000Z" })} permanent={PERMANENT} reportId="report-1" todayKey="2026-11-19" />);
    expect(seen.markPrecautionsSeen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: /Dynamic/ }));
    await waitFor(() => expect(seen.markPrecautionsSeen).toHaveBeenCalledWith("report-1", "2026-11-19"));
    await waitFor(() => expect(screen.queryByTestId("precautions-dot")).not.toBeInTheDocument());
    expect(seen.markPrecautionsSeen).toHaveBeenCalledTimes(1);
  });

  it("does not call the server when there is nothing new, or when only the Permanent tab is open", async () => {
    render(<PrecautionsCard dynamic={dynamic({ seenAt: null, kind: "feedback", badge: "Updated after feedback" })} permanent={PERMANENT} reportId="report-1" />);
    await act(async () => {});
    expect(seen.markPrecautionsSeen).not.toHaveBeenCalled();
    cleanup();

    render(<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Dynamic" }));
    await act(async () => {});
    expect(seen.markPrecautionsSeen).not.toHaveBeenCalled();
  });

  it("shows the dot again when a newer update arrives after the old one was seen", async () => {
    const first = dynamic({ kind: "feedback", badge: "Updated after feedback", seenAt: null, updatedAt: "2026-11-19T11:00:00.000Z" });
    const { rerender } = render(<PrecautionsCard dynamic={first} permanent={PERMANENT} reportId="report-1" />);
    fireEvent.click(screen.getByRole("tab", { name: /Dynamic/ }));
    await waitFor(() => expect(screen.queryByTestId("precautions-dot")).not.toBeInTheDocument());

    // the Dynamic tab is still open when the next update lands: it is read at once, not left as a dot
    seen.markPrecautionsSeen.mockResolvedValue({ success: true, seenAt: "2026-11-19T13:00:00.000Z" });
    rerender(<PrecautionsCard dynamic={dynamic({ kind: "pain_override", badge: "Updated after Pain Override", seenAt: "2026-11-19T12:00:00.000Z", updatedAt: "2026-11-19T12:30:00.000Z" })} permanent={PERMANENT} reportId="report-1" />);
    await waitFor(() => expect(seen.markPrecautionsSeen).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("precautions-badge")).toHaveTextContent("Updated after Pain Override");

    // on the Permanent tab, a newer update shows the dot
    fireEvent.click(screen.getByRole("tab", { name: "Permanent" }));
    rerender(<PrecautionsCard dynamic={dynamic({ kind: "missed_day", badge: "Updated after a missed day", seenAt: "2026-11-19T13:00:00.000Z", updatedAt: "2026-11-19T14:00:00.000Z" })} permanent={PERMANENT} reportId="report-1" />);
    expect(screen.getByTestId("precautions-dot")).toBeInTheDocument();
  });

  it("supports arrow keys between the tabs", () => {
    render(<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Permanent" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Dynamic" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Dynamic" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Permanent" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Precautions card in the sidebar", () => {
  it("sits directly under the Triage summary and above Adaptive intake", () => {
    render(
      <SidebarIntake
        flowError={null}
        flowPhase="ready"
        onError={vi.fn()}
        onPreparing={vi.fn()}
        onRerunAnalysis={vi.fn()}
        onTriageReady={vi.fn()}
        precautions={<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />}
        reportsSubmitted
        summary={
          <ConditionCard
            condition={{ title: "Lumbar strain", summary: "Muscle strain in the low back.", source: "symptoms_only", requiresInPersonCare: false, careReason: null }}
            escalation={null}
          />
        }
      />,
    );

    const triage = screen.getByText("Triage summary").closest("section") as HTMLElement;
    const precautions = screen.getByTestId("precautions-card");
    const intake = screen.getByText("Adaptive intake").closest("section") as HTMLElement;

    expect(triage.nextElementSibling).toBe(precautions);
    expect(precautions.nextElementSibling).toBe(intake);
    // same card design as its neighbours
    expect(precautions.className).toContain("workspace-panel");
    expect(precautions.className).toContain("bg-zinc-900");
  });

  const renderSidebar = (hideCrossQuestioning: boolean) =>
    render(
      <SidebarIntake
        flowError={null}
        flowPhase="ready"
        hideCrossQuestioning={hideCrossQuestioning}
        onError={vi.fn()}
        onPreparing={vi.fn()}
        onRerunAnalysis={vi.fn()}
        onTriageReady={vi.fn()}
        precautions={<PrecautionsCard dynamic={dynamic()} permanent={PERMANENT} reportId="report-1" />}
        reportsSubmitted
      />,
    );

  it("drops the Cross-questioning card once the plan exists, and the Precautions card stays", () => {
    renderSidebar(true);
    expect(screen.queryByText("Adaptive intake")).not.toBeInTheDocument();
    expect(screen.queryByText("Cross-questioning")).not.toBeInTheDocument();
    expect(screen.queryByText("Your tailored triage questions are ready.")).not.toBeInTheDocument();
    expect(screen.getByTestId("precautions-card")).toBeInTheDocument();
  });

  it("still shows the Cross-questioning card before the plan exists", () => {
    renderSidebar(false);
    expect(screen.getByText("Cross-questioning")).toBeInTheDocument();
  });
});

describe("Precautions card for a plan saved before precautions existed", () => {
  it("shows the safe defaults and an unread Week badge, and stores them when the Dynamic tab is opened", async () => {
    const legacy = dynamic({ kind: "week", badge: "Week 2 • Active", weekNumber: 2, seenAt: null, items: ["Calm (week 2): Settle the tissue.", "Move slowly.", "Stop if sharp pain."] });
    render(<PrecautionsCard dynamic={legacy} permanent={legacyPermanentPrecautions()} reportId="report-1" todayKey="2026-11-19" />);

    const card = screen.getByTestId("precautions-card");
    for (const item of SAFE_DEFAULTS) expect(within(card).getByText(item)).toBeInTheDocument();
    expect(screen.getByTestId("precautions-dot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /dynamic/i }));
    await waitFor(() => expect(seen.markPrecautionsSeen).toHaveBeenCalledWith("report-1", "2026-11-19"));
    expect(screen.getByTestId("precautions-badge")).toHaveTextContent("Week 2 • Active");
    await waitFor(() => expect(screen.queryByTestId("precautions-dot")).not.toBeInTheDocument());
  });
});
