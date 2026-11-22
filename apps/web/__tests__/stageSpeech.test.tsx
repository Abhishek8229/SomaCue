import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { StageHud } from "@/components/stage/stage-types";
import { initialStageState, speechEnabled, stageReducer } from "@/components/stage/useStageController";
import { useStageSpeech } from "@/components/stage/useStageSpeech";
import { resolveStageExercise } from "@/lib/kinematics/exercise";
import type { Phase } from "@/lib/kinematics/timeline";
import { enforceSilence, speak, stopSpeaking } from "@/lib/speech";

vi.mock("@/lib/speech", () => ({
  speak: vi.fn(() => ({ cancel: vi.fn() })),
  stopSpeaking: vi.fn(),
  enforceSilence: vi.fn(),
  speechSupported: vi.fn(() => true),
  isSpeaking: vi.fn(() => false),
}));

type Props = Parameters<typeof useStageSpeech>[0];

const exercise = resolveStageExercise({
  exerciseName: "Supine Pelvic Tilt",
  voiceCue: "Lie on your back with your knees bent and feet flat on the floor.",
});

const hud = (rep: number, phase: Phase, waitingStep: string | null = null, done = false): StageHud => ({
  rep,
  set: 1,
  phase,
  elapsed: 0,
  total: 0,
  done,
  posture: "supine",
  phaseRemaining: 1,
  mirrored: false,
  stepKey: done ? "done" : `1-${rep}-${phase}`,
  waitingStep,
});

const baseProps = (overrides: Partial<Props> = {}): Props => ({
  exercise,
  hud: hud(1, "up"),
  playing: true,
  stopped: false,
  pace: "realtime",
  voiceOn: true,
  restartKey: 0,
  dispatch: vi.fn(),
  ...overrides,
});

describe("useStageSpeech", () => {
  beforeEach(() => {
    vi.mocked(speak).mockClear();
    vi.mocked(stopSpeaking).mockClear();
  });

  afterEach(() => cleanup());

  it("never speaks in real-time pace, for steps or the end", () => {
    const props = baseProps();
    const { rerender } = renderHook((current: Props) => useStageSpeech(current), { initialProps: props });

    rerender({ ...props, hud: hud(1, "hold") });
    rerender({ ...props, hud: hud(1, "down") });
    rerender({ ...props, hud: hud(2, "up") });
    rerender({ ...props, hud: hud(3, "down", null, true) });

    expect(speak).not.toHaveBeenCalled();
  });

  it("stops any speech when the pace switches to real-time", () => {
    const props = baseProps({ pace: "guided", hud: hud(1, "up", "1-1-up") });
    const { rerender } = renderHook((current: Props) => useStageSpeech(current), { initialProps: props });
    expect(speak).toHaveBeenCalledTimes(1);
    vi.mocked(stopSpeaking).mockClear();

    rerender({ ...props, pace: "realtime" });
    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("still speaks a waiting step in guided pace and releases it when done", () => {
    const dispatch = vi.fn();
    renderHook((current: Props) => useStageSpeech(current), {
      initialProps: baseProps({ pace: "guided", hud: hud(1, "up", "1-1-up"), dispatch }),
    });

    expect(speak).toHaveBeenCalledTimes(1);
    const [text, onDone] = vi.mocked(speak).mock.calls[0];
    expect(text).toContain(exercise.voiceCue);

    onDone();
    expect(dispatch).toHaveBeenCalledWith({ type: "release", step: "1-1-up" });
  });

  it("announces the end in guided pace", () => {
    const props = baseProps({ pace: "guided", hud: hud(3, "down") });
    const { rerender } = renderHook((current: Props) => useStageSpeech(current), { initialProps: props });

    rerender({ ...props, hud: hud(3, "done", null, true) });
    expect(speak).toHaveBeenCalledWith("Exercise complete. Well done.", expect.any(Function), 6);
  });

  it("keeps the guided end line when playback ends in the same update", () => {
    const props = baseProps({ pace: "guided", hud: hud(3, "down") });
    const { rerender } = renderHook((current: Props) => useStageSpeech(current), { initialProps: props });
    vi.mocked(stopSpeaking).mockClear();

    // The canvas reports the done step and the finish together, so playing flips to false at once.
    rerender({ ...props, hud: hud(3, "done", null, true), playing: false });
    expect(speak).toHaveBeenCalledWith("Exercise complete. Well done.", expect.any(Function), 6);
    expect(stopSpeaking).not.toHaveBeenCalled();

    // Stopping the session afterwards still silences it.
    rerender({ ...props, hud: hud(3, "done", null, true), playing: false, stopped: true });
    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("still silences a guided pause before the end", () => {
    const props = baseProps({ pace: "guided", hud: hud(1, "up", "1-1-up") });
    const { rerender } = renderHook((current: Props) => useStageSpeech(current), { initialProps: props });
    vi.mocked(stopSpeaking).mockClear();

    rerender({ ...props, playing: false });
    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("keeps enforcing silence in real-time pace, and stops when Guided resumes", () => {
    vi.useFakeTimers();
    try {
      vi.mocked(enforceSilence).mockClear();
      const props = baseProps({ pace: "guided", hud: hud(1, "up", "1-1-up") });
      const { rerender } = renderHook((current: Props) => useStageSpeech(current), { initialProps: props });

      rerender({ ...props, pace: "realtime" });
      vi.advanceTimersByTime(2000);
      expect(vi.mocked(enforceSilence).mock.calls.length).toBeGreaterThanOrEqual(3);

      vi.mocked(enforceSilence).mockClear();
      rerender({ ...props, pace: "guided" });
      vi.advanceTimersByTime(2000);
      expect(enforceSilence).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("silences the voice when the tab is hidden", () => {
    renderHook((current: Props) => useStageSpeech(current), {
      initialProps: baseProps({ pace: "guided", hud: hud(1, "up", "1-1-up") }),
    });
    vi.mocked(stopSpeaking).mockClear();

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(stopSpeaking).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
});

describe("speech setting", () => {
  it("is off in real-time pace even with the voice on", () => {
    expect(speechEnabled({ pace: "realtime", voiceOn: true })).toBe(false);
    expect(speechEnabled({ pace: "guided", voiceOn: true })).toBe(true);
    expect(speechEnabled({ pace: "guided", voiceOn: false })).toBe(false);
  });

  it("keeps the guided voice choice across pace changes", () => {
    let state = initialStageState(2);
    state = stageReducer(state, { type: "voice", on: false });
    state = stageReducer(state, { type: "pace", pace: "realtime" });
    expect(state.voiceOn).toBe(false);
    expect(speechEnabled(state)).toBe(false);
    state = stageReducer(state, { type: "pace", pace: "guided" });
    expect(state.voiceOn).toBe(false);

    state = stageReducer(state, { type: "voice", on: true });
    state = stageReducer(state, { type: "pace", pace: "realtime" });
    expect(speechEnabled(state)).toBe(false);
    state = stageReducer(state, { type: "pace", pace: "guided" });
    expect(state.voiceOn).toBe(true);
    expect(speechEnabled(state)).toBe(true);
  });
});
