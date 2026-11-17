import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConditionCard } from "@/components/workspace/ConditionCard";
import { EscalationAlert } from "@/components/workspace/EscalationAlert";
import type { DetectedCondition, Escalation } from "@/lib/clinical/assessment";

const condition: DetectedCondition = {
  title: "L4–L5 disc bulge",
  summary: "The disc between the 4th and 5th lumbar vertebrae pushes outward. It can irritate nearby nerves.",
  source: "reports_and_scans",
  requiresInPersonCare: false,
  careReason: "No warning signs were reported.",
};

const escalation: Escalation = {
  kind: "progress",
  reason: "Your sessions show your symptoms are getting worse.",
  evidence: ["Pain Override was used on 2 separate days in the last 14 days."],
  escalatedAt: "2026-11-20T10:00:00.000Z",
};

afterEach(cleanup);

describe("ConditionCard", () => {
  it("shows the condition, description and source basis", () => {
    render(<ConditionCard condition={condition} escalation={null} />);

    expect(screen.getByText("L4–L5 disc bulge")).toBeInTheDocument();
    expect(screen.getByText(/pushes outward/)).toBeInTheDocument();
    expect(screen.getByText("Derived from medical reports & scans")).toBeInTheDocument();
    expect(screen.getByText("Suitable for guided online rehab")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("states that in-person evaluation is required when escalated", () => {
    render(<ConditionCard condition={condition} escalation={escalation} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Requires immediate in-person medical evaluation");
    expect(screen.getByRole("alert")).toHaveTextContent(escalation.reason);
  });
});

describe("EscalationAlert", () => {
  it("explains the lockout and offers a new intake", () => {
    const onStartNewIntake = vi.fn();
    render(<EscalationAlert condition={condition} escalation={escalation} onStartNewIntake={onStartNewIntake} />);

    expect(screen.getByText("Stop your exercises and get seen in person")).toBeInTheDocument();
    expect(screen.getByText(escalation.evidence[0])).toBeInTheDocument();
    expect(screen.getByText(/local emergency number/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start a new intake" }));
    expect(onStartNewIntake).toHaveBeenCalledTimes(1);
  });
});
