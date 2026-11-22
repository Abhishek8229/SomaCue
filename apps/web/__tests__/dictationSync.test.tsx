import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const dictation = vi.hoisted(() => ({
  state: { isListening: false, transcript: "", startListening: () => {}, stopListening: () => {} },
}));
vi.mock("@/hooks/useDictation", () => ({ useDictation: () => dictation.state }));
vi.mock("@/actions/intake", () => ({ submitIntakeForm: vi.fn() }));
vi.mock("@/actions/precautions", () => ({ markPrecautionsSeen: vi.fn() }));

import { SidebarIntake } from "@/app/workspace/WorkspaceParts";

const SAMPLE = "Pain and stiffness around the right knee after long walks.";

function sidebar() {
  return (
    <SidebarIntake
      flowError={null}
      flowPhase="discovery"
      onError={vi.fn()}
      onPreparing={vi.fn()}
      onRerunAnalysis={vi.fn()}
      onTriageReady={vi.fn()}
      reportsSubmitted={false}
    />
  );
}

const box = () => screen.getByLabelText("Describe your symptoms") as HTMLTextAreaElement;

/** The speech hook grew its transcript: render again with the new text, as React does on a state change. */
function say(rerender: (ui: React.ReactElement) => void, transcript: string) {
  dictation.state = { ...dictation.state, transcript };
  rerender(sidebar());
}

beforeEach(() => {
  dictation.state = { isListening: true, transcript: "", startListening: () => {}, stopListening: () => {} };
});
afterEach(() => cleanup());

describe("voice dictation fills the symptoms box", () => {
  it("replaces the untouched sample text with what was dictated", () => {
    const { rerender } = render(sidebar());
    expect(box().value).toBe(SAMPLE);

    say(rerender, "my lower back hurts when I bend");
    expect(box().value).toBe("my lower back hurts when I bend");
  });

  it("adds each new phrase to the end, once, as the transcript grows", () => {
    const { rerender } = render(sidebar());
    say(rerender, "my lower back hurts");
    say(rerender, "my lower back hurts and it spreads down my leg");
    expect(box().value).toBe("my lower back hurts and it spreads down my leg");

    // a re-render with the same transcript adds nothing
    rerender(sidebar());
    rerender(sidebar());
    expect(box().value).toBe("my lower back hurts and it spreads down my leg");
  });

  it("keeps what the patient typed and appends the speech after it", () => {
    const { rerender } = render(sidebar());
    fireEvent.change(box(), { target: { value: "Right knee swelling since Monday." } });
    say(rerender, "worse on stairs");
    expect(box().value).toBe("Right knee swelling since Monday. worse on stairs");
  });

  it("does not undo typing that happens after dictation", () => {
    const { rerender } = render(sidebar());
    say(rerender, "numbness in my left foot");
    fireEvent.change(box(), { target: { value: "Numbness in my left foot, started two days ago." } });
    rerender(sidebar());
    expect(box().value).toBe("Numbness in my left foot, started two days ago.");

    // and a later phrase lands after the edited text, not over it
    say(rerender, "numbness in my left foot and it is spreading");
    expect(box().value).toBe("Numbness in my left foot, started two days ago. and it is spreading");
  });

  it("does not bring dictated text back after the patient deletes it", () => {
    const { rerender } = render(sidebar());
    say(rerender, "sharp pain in my shoulder");
    fireEvent.change(box(), { target: { value: "" } });
    rerender(sidebar());
    expect(box().value).toBe("");
  });

  it("ignores empty or whitespace-only recognition results", () => {
    const { rerender } = render(sidebar());
    say(rerender, "   ");
    expect(box().value).toBe(SAMPLE);
  });
});
