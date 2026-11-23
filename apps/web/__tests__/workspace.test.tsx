import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/actions/intake", () => ({ submitIntakeForm: vi.fn() }));
vi.mock("@/actions/aiJobs", () => ({ startIntakeJob: vi.fn(), startQuizJob: vi.fn(), startPainRescheduleJob: vi.fn(), startFeedbackJob: vi.fn(), getAiJob: vi.fn() }));
vi.mock("@/hooks/useDictation", () => ({
  useDictation: () => ({
    isListening: false,
    transcript: "",
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

import { SidebarIntake } from "@/app/workspace/WorkspaceParts";

const UUID = "12f80538-4e07-4160-82c1-48d2dccb3612";

function renderIntake() {
  return render(
    <SidebarIntake
      flowError={null}
      flowPhase="discovery"
      onError={vi.fn()}
      onPreparing={vi.fn()}
      onRerunAnalysis={vi.fn()}
      onTriageReady={vi.fn()}
      reportsSubmitted={false}
    />,
  );
}

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, storage: "local", url: `/uploads/${UUID}.pdf` }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Workspace intake", () => {
  it("offers separate imaging and prescription dropzones", () => {
    renderIntake();

    const scans = screen.getByLabelText(/Medical scans \/ imaging/i) as HTMLInputElement;
    const prescriptions = screen.getByLabelText(/Clinical prescriptions & notes/i) as HTMLInputElement;

    expect(scans.type).toBe("file");
    expect(prescriptions.type).toBe("file");
    expect(scans).not.toBe(prescriptions);
  });

  it("keeps Start diagnostic locked until the no-prescription acknowledgment is ticked", async () => {
    const { container } = renderIntake();
    const start = screen.getByRole("button", { name: "Start diagnostic" });

    const scanInput = container.querySelector("#intake-scan-files") as HTMLInputElement;
    fireEvent.change(scanInput, {
      target: { files: [new File(["x"], "mri.pdf", { type: "application/pdf" })] },
    });
    await waitFor(() => expect(screen.getByText(/Uploaded successfully/)).toBeInTheDocument());
    expect(start).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /may not be completely accurate/i }));
    expect(start).toBeEnabled();
  });
});
