import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StopReportForm } from "@/components/stage/StopReportForm";
import { initialStageState, stageReducer } from "@/components/stage/useStageController";
import { defaultView, viewLabels } from "@/lib/kinematics/camera-presets";

afterEach(cleanup);

const exercises = ["Glute Bridge", "Gentle Cat Cow"];

function renderForm(onSubmit = vi.fn(), onClose = vi.fn()) {
  render(
    <StopReportForm
      errorMessage={null}
      exercises={exercises}
      initialExercise="Glute Bridge"
      initialRegions={["lumbar"]}
      isSubmitting={false}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onClose };
}

describe("StopReportForm", () => {
  it("always shows the urgent-care notice", () => {
    renderForm();
    expect(screen.getByRole("dialog", { name: "Stop and report" })).toBeInTheDocument();
    expect(screen.getByText(/get urgent medical care now/i)).toBeInTheDocument();
    expect(screen.getByText(/not an emergency service/i)).toBeInTheDocument();
  });

  it("pre-selects the current exercise and region and needs a type and description", () => {
    const { onSubmit } = renderForm();
    expect(screen.getByRole("button", { name: "Glute Bridge" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lower back" })).toHaveAttribute("aria-pressed", "true");
    const save = screen.getByRole("button", { name: "Save report" });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Sharp pain" }));
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/in your own words/i), { target: { value: "  Sharp pain lifting  " } });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({
      exerciseNames: ["Glute Bridge"],
      painType: "sharp_pain",
      regions: ["lumbar"],
      details: "Sharp pain lifting",
    });
  });

  it("disables saving when every region or exercise is cleared", () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Sudden loss of movement" }));
    fireEvent.change(screen.getByLabelText(/in your own words/i), { target: { value: "Knee locked" } });
    fireEvent.click(screen.getByRole("button", { name: "Lower back" }));
    expect(screen.getByRole("button", { name: "Save report" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Left knee" }));
    fireEvent.click(screen.getByRole("button", { name: "Glute Bridge" }));
    expect(screen.getByRole("button", { name: "Save report" })).toBeDisabled();
  });

  it("closes with Escape", () => {
    const { onClose } = renderForm();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("stage controller", () => {
  it("steps through exercises within bounds and restarts the motion", () => {
    let state = initialStageState(3);
    state = stageReducer(state, { type: "prev" });
    expect(state.index).toBe(0);
    state = stageReducer(state, { type: "next" });
    state = stageReducer(state, { type: "next" });
    state = stageReducer(state, { type: "next" });
    expect(state.index).toBe(2);
    expect(state.restartKey).toBe(2);
  });

  it("a stop aborts playback and locks every control until resumed", () => {
    let state = stageReducer(initialStageState(2), { type: "toggle" });
    expect(state.playing).toBe(true);
    state = stageReducer(state, { type: "stop" });
    expect(state).toMatchObject({ playing: false, stopped: true });
    expect(stageReducer(state, { type: "toggle" }).playing).toBe(false);
    expect(stageReducer(state, { type: "next" }).index).toBe(0);
    state = stageReducer(state, { type: "resume" });
    expect(state.stopped).toBe(false);
    expect(stageReducer(state, { type: "toggle" }).playing).toBe(true);
  });

  it("switches views and speed", () => {
    let state = stageReducer(initialStageState(1), { type: "view", view: 1 });
    expect(state.view.view).toBe(1);
    state = stageReducer(state, { type: "speed", speed: 0.5 });
    expect(state.speed).toBe(0.5);
  });

  it("follows the posture default until the user picks a view, and resets on a new exercise", () => {
    let state = initialStageState(3);
    expect(state.view.view).toBeNull();
    state = stageReducer(state, { type: "view", view: 0 });
    expect(state.view.view).toBe(0);
    state = stageReducer(state, { type: "next" });
    expect(state.view.view).toBeNull();
    state = stageReducer(state, { type: "view", view: 0 });
    state = stageReducer(state, { type: "load", count: 2 });
    expect(state.view.view).toBeNull();
  });
});

describe("default camera view", () => {
  it("opens lying exercises on Side and upright ones on the front", () => {
    expect(defaultView("supine")).toBe(1);
    expect(defaultView("prone")).toBe(1);
    expect(viewLabels("supine")[defaultView("supine")]).toBe("Side");
    expect(defaultView("standing")).toBe(0);
    expect(defaultView("seated")).toBe(0);
    expect(defaultView("quadruped")).toBe(0);
    expect(viewLabels("standing")[defaultView("standing")]).toBe("Anterior");
  });
});
