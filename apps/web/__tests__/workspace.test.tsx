import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import WorkspacePage from "@/app/workspace/page";

vi.mock("@/components/workspace/StagePanel", () => ({
  StagePanel: ({ activeDemo }: { activeDemo: string }) => (
    <div data-testid="stage-panel" data-active-demo={activeDemo}>
      3D stage
    </div>
  ),
}));

const REPORT = "L4-L5 disc herniation with radiculopathy";

function submitReport() {
  fireEvent.change(screen.getByLabelText(/MRI \/ medical report/i), {
    target: { value: REPORT },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit for Analysis" }));
}

async function waitForScreening() {
  await screen.findByText(/Question 1 of/i, {}, { timeout: 10000 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ region: "lumbar", level: "L4", pathology: "herniation" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
});

describe("Workspace integration", () => {
  it("locks the 3D viewer when a red flag is reported", async () => {
    render(<WorkspacePage />);
    submitReport();
    await waitForScreening();

    fireEvent.click(screen.getByRole("button", { name: "Yes" }));

    expect(screen.getByText(/Red flag identified/i)).toBeInTheDocument();
    expect(screen.getByTestId("stage-lock")).toBeInTheDocument();
    expect(screen.queryByTestId("approved-roster")).not.toBeInTheDocument();
  });

  it("filters contraindicated exercises and renders the approved list", async () => {
    render(<WorkspacePage />);
    submitReport();
    await waitForScreening();

    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "No" }));
    }

    expect(await screen.findByTestId("approved-roster")).toBeInTheDocument();
    expect(screen.getByText("Neutral breathing")).toBeInTheDocument();
    expect(screen.queryByText("Deadlift")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-lock")).not.toBeInTheDocument();
    expect(screen.getByTestId("stage-panel")).toBeInTheDocument();
  });
});
