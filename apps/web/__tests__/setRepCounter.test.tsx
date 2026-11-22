import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SetRepCounter } from "@/components/workspace/SetRepCounter";
import type { RepProgress } from "@/lib/kinematics/progress";

const progress = (overrides: Partial<RepProgress> = {}): RepProgress => ({
  set: 1,
  setsDone: 0,
  repsDoneInSet: 3,
  allDone: false,
  ...overrides,
});

const filledSegments = () => screen.getAllByTestId("rep-segment").filter((segment) => segment.dataset.filled === "true");

describe("SetRepCounter", () => {
  afterEach(() => cleanup());

  it("shows the set badge, the rep count and one segment per rep", () => {
    render(<SetRepCounter celebration={null} progress={progress()} reducedMotion={false} reps={8} sets={2} />);

    expect(screen.getByTestId("set-badge")).toHaveTextContent("Set1/2");
    expect(screen.getByTestId("rep-count")).toHaveTextContent("Rep 3 of 8");
    expect(screen.getAllByTestId("rep-segment")).toHaveLength(8);
    expect(filledSegments()).toHaveLength(3);
    expect(screen.getAllByTestId("set-pip")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("pops the rep number and flashes the new segment on a rep", () => {
    const { container } = render(
      <SetRepCounter celebration={{ kind: "rep", id: 1 }} progress={progress()} reducedMotion={false} reps={8} sets={2} />,
    );

    expect(container.querySelector(".rep-counter-pop")).toHaveTextContent("3");
    const flashing = container.querySelectorAll(".rep-counter-segment-flash");
    expect(flashing).toHaveLength(1);
    expect(screen.getAllByTestId("rep-segment").indexOf(flashing[0] as HTMLElement)).toBe(2);
    expect(container.querySelector(".rep-counter-badge-burst")).toBeNull();
    // Reps are not announced, to avoid chatter.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("bursts the set badge and announces a completed set", () => {
    const { container } = render(
      <SetRepCounter
        celebration={{ kind: "set", id: 2 }}
        progress={progress({ setsDone: 1, repsDoneInSet: 8 })}
        reducedMotion={false}
        reps={8}
        sets={2}
      />,
    );

    expect(screen.getByTestId("set-badge")).toHaveClass("rep-counter-badge-burst");
    expect(container.querySelectorAll(".rep-counter-particle")).toHaveLength(8);
    expect(container.querySelectorAll(".rep-counter-ring")).toHaveLength(2);
    expect(container.querySelector(".rep-counter-set-label")).toHaveTextContent("Set 1 complete");
    expect(screen.getByRole("status")).toHaveTextContent("Set 1 complete");
    expect(screen.getAllByTestId("set-pip").filter((pip) => pip.dataset.filled === "true")).toHaveLength(1);
  });

  it("skips rings and particles with reduced motion", () => {
    const { container } = render(
      <SetRepCounter
        celebration={{ kind: "set", id: 3 }}
        progress={progress({ setsDone: 1, repsDoneInSet: 8 })}
        reducedMotion
        reps={8}
        sets={2}
      />,
    );

    expect(container.querySelector(".rep-counter-particle")).toBeNull();
    expect(container.querySelector(".rep-counter-ring")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Set 1 complete");
  });

  it("uses one continuous bar for many reps", () => {
    render(
      <SetRepCounter celebration={null} progress={progress({ repsDoneInSet: 5 })} reducedMotion={false} reps={20} sets={1} />,
    );

    expect(screen.queryAllByTestId("rep-segment")).toHaveLength(0);
    expect(screen.getByTestId("rep-bar")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("rep-count")).toHaveTextContent("Rep 5 of 20");
  });

  it("shows a completed state when every set is done", () => {
    render(
      <SetRepCounter
        celebration={null}
        progress={{ set: 2, setsDone: 2, repsDoneInSet: 8, allDone: true }}
        reducedMotion={false}
        reps={8}
        sets={2}
      />,
    );

    expect(screen.getByTestId("rep-count")).toHaveTextContent("All sets done");
    expect(filledSegments()).toHaveLength(8);
  });
});
