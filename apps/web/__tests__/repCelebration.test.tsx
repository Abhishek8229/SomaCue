import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { playRepChime, playSetChime } from "@/lib/audio/celebrationSound";
import type { StageHud } from "@/components/stage/stage-types";
import { useRepCelebration } from "@/components/stage/useRepCelebration";
import type { Phase } from "@/lib/kinematics/timeline";

vi.mock("@/lib/audio/celebrationSound", () => ({
  playRepChime: vi.fn(),
  playSetChime: vi.fn(),
  primeCelebrationAudio: vi.fn(),
}));

type Props = Parameters<typeof useRepCelebration>[0];

const spec = { sets: 2, reps: 3 };

const hud = (rep: number, set: number, phase: Phase, done = false): StageHud => ({
  rep,
  set,
  phase,
  elapsed: 0,
  total: 0,
  done,
  posture: "standing",
  phaseRemaining: 0,
  mirrored: false,
  stepKey: `${set}-${rep}-${phase}`,
  waitingStep: null,
});

const setup = (initial: Partial<Props> = {}) => {
  const initialProps: Props = { spec, hud: hud(1, 1, "down"), playing: true, stopped: false, resetKey: "0-0", ...initial };
  const view = renderHook((props: Props) => useRepCelebration(props), { initialProps });
  return { ...view, initialProps };
};

describe("useRepCelebration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(playRepChime).mockClear();
    vi.mocked(playSetChime).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("plays the small chime once when a rep's return ends, then clears", () => {
    const { result, rerender, initialProps } = setup();
    expect(result.current.celebration).toBeNull();

    rerender({ ...initialProps, hud: hud(1, 1, "rest") });
    expect(playRepChime).toHaveBeenCalledTimes(1);
    expect(playSetChime).not.toHaveBeenCalled();
    expect(result.current.celebration).toMatchObject({ kind: "rep" });

    // Same count again: no second chime.
    rerender({ ...initialProps, hud: hud(2, 1, "up") });
    expect(playRepChime).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(700));
    expect(result.current.celebration).toBeNull();
  });

  it("plays the set chime, not the rep chime, when a set finishes", () => {
    const { result, rerender, initialProps } = setup({ hud: hud(3, 1, "down") });

    rerender({ ...initialProps, hud: hud(3, 1, "set-rest") });
    expect(playSetChime).toHaveBeenCalledTimes(1);
    expect(playRepChime).not.toHaveBeenCalled();
    expect(result.current.celebration).toMatchObject({ kind: "set" });

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.celebration).not.toBeNull();
    act(() => vi.advanceTimersByTime(700));
    expect(result.current.celebration).toBeNull();
  });

  it("celebrates the last set even though playback ends in the same update", () => {
    const { rerender, initialProps } = setup({ hud: hud(3, 2, "down") });

    rerender({ ...initialProps, hud: hud(3, 2, "done", true), playing: false });
    expect(playSetChime).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while paused or stopped", () => {
    const paused = setup({ playing: false });
    paused.rerender({ ...paused.initialProps, hud: hud(1, 1, "rest") });
    paused.unmount();

    const stopped = setup({ stopped: true });
    stopped.rerender({ ...stopped.initialProps, hud: hud(1, 1, "rest") });

    expect(playRepChime).not.toHaveBeenCalled();
    expect(playSetChime).not.toHaveBeenCalled();
  });

  it("resets without celebrating on a restart or a new exercise", () => {
    const { result, rerender, initialProps } = setup({ hud: hud(2, 1, "rest") });

    // Restart: the count drops and the reset key changes.
    rerender({ ...initialProps, hud: null, resetKey: "0-1" });
    rerender({ ...initialProps, hud: hud(1, 1, "up"), resetKey: "0-1" });
    // New exercise whose first sample already counts a rep.
    rerender({ ...initialProps, hud: hud(1, 1, "rest"), resetKey: "1-2" });
    expect(playRepChime).not.toHaveBeenCalled();
    expect(result.current.celebration).toBeNull();

    // Later reps in the new run still celebrate.
    rerender({ ...initialProps, hud: hud(2, 1, "rest"), resetKey: "1-2" });
    expect(playRepChime).toHaveBeenCalledTimes(1);
  });

  it("ignores jumps of more than one rep", () => {
    const { rerender, initialProps } = setup({ hud: hud(1, 1, "up") });

    rerender({ ...initialProps, hud: hud(3, 1, "up") });
    expect(playRepChime).not.toHaveBeenCalled();
    expect(playSetChime).not.toHaveBeenCalled();
  });
});
