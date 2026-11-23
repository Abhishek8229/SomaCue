import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { submitIntakeForm } = vi.hoisted(() => ({
  submitIntakeForm: vi.fn(),
}));

// The browser starts a background job and polls it; here the job simply resolves with the action's result.
vi.mock("@/actions/aiJobs", () => ({ startIntakeJob: submitIntakeForm }));
vi.mock("@/lib/jobs/client", () => ({ runAiJob: (start: () => Promise<unknown>) => start() }));
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

function renderIntake(onPreparing = vi.fn()) {
  const view = render(
    <SidebarIntake
      flowError={null}
      flowPhase="discovery"
      onError={vi.fn()}
      onPreparing={onPreparing}
      onRerunAnalysis={vi.fn()}
      onTriageReady={vi.fn()}
      reportsSubmitted={false}
    />,
  );
  return { ...view, onPreparing };
}

function addFiles(container: HTMLElement, category: "scan" | "prescription", names: string[]) {
  const input = container.querySelector(`#intake-${category}-files`) as HTMLInputElement;
  const files = names.map((name) => new File(["x"], name, { type: "application/pdf" }));
  fireEvent.change(input, { target: { files } });
}

const submittedForm = () => submitIntakeForm.mock.calls[0][0] as FormData;

describe("intake uploads", () => {
  beforeEach(() => {
    let count = 0;
    globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${(count += 1)}`);
    globalThis.URL.revokeObjectURL = vi.fn();
    let uploads = 0;
    // Files go to the /api/upload route, which answers with where the file was stored.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        uploads += 1;
        return new Response(
          JSON.stringify({
            success: true,
            storage: "local",
            url: `/uploads/${UUID.slice(0, -1)}${uploads}.pdf`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    submitIntakeForm.mockResolvedValue({ success: false, error: "AI_PROVIDER_FAILED" });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows two separate upload sections", () => {
    renderIntake();

    expect(screen.getByText("Medical scans / imaging")).toBeInTheDocument();
    expect(screen.getByText("Clinical prescriptions & notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start diagnostic" })).toBeInTheDocument();
  });

  it("requires the AI disclaimer when no prescription is uploaded", async () => {
    const { container } = renderIntake();
    const start = screen.getByRole("button", { name: "Start diagnostic" });
    const checkbox = screen.getByRole("checkbox", { name: /may not be completely accurate/i });

    addFiles(container, "scan", ["mri.pdf"]);
    await waitFor(() => expect(screen.getByText(/Uploaded successfully/)).toBeInTheDocument());
    expect(start).toBeDisabled();

    fireEvent.click(checkbox);
    expect(start).toBeEnabled();

    await act(async () => {
      fireEvent.click(start);
    });
    const form = submittedForm();
    expect(form.getAll("scanUrl")).toHaveLength(1);
    expect(form.getAll("prescriptionUrl")).toHaveLength(0);
    expect(form.get("aiDisclaimerAccepted")).toBe("true");
  });

  it("does not ask for the disclaimer once a prescription is uploaded", async () => {
    const { container, onPreparing } = renderIntake();

    addFiles(container, "scan", ["xray.pdf", "ct.pdf"]);
    addFiles(container, "prescription", ["physio-notes.pdf"]);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("Prescription provided")).toBeInTheDocument();

    const start = screen.getByRole("button", { name: "Start diagnostic" });
    await waitFor(() => expect(start).toBeEnabled());

    await act(async () => {
      fireEvent.click(start);
    });
    const form = submittedForm();
    expect(form.getAll("scanUrl")).toHaveLength(2);
    expect(form.getAll("prescriptionUrl")).toHaveLength(1);
    expect(form.get("aiDisclaimerAccepted")).toBeNull();
    expect(onPreparing).toHaveBeenCalledWith(
      expect.objectContaining({ scanCount: 2, prescriptionCount: 1 }),
    );
  });

  it("asks for the disclaimer again when the only prescription is removed", async () => {
    const { container } = renderIntake();

    addFiles(container, "prescription", ["rx.pdf"]);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove rx.pdf" }));
    expect(screen.getByRole("checkbox", { name: /may not be completely accurate/i })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Start diagnostic" })).toBeDisabled();
  });
});
