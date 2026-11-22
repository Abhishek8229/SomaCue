"use client";

import { useCallback, useReducer } from "react";
import type { StageHud } from "./stage-types";

export type StageState = {
  index: number;
  count: number;
  playing: boolean;
  speed: 0.5 | 1;
  stopped: boolean;
  /** view chosen by the user for this exercise; null follows the posture default */
  view: { id: number; view: 0 | 1 | null };
  /** bumps when the current exercise must restart from its first frame */
  restartKey: number;
  hud: StageHud | null;
  /** guided: wait for each spoken instruction before moving. realtime: continuous. */
  pace: StagePace;
  /** spoken instructions on or off (on by default) */
  voiceOn: boolean;
  /** last guided step the figure may perform; the id makes repeats distinct */
  release: { id: number; step: string | null };
};

export type StagePace = "guided" | "realtime";

export type StageAction =
  | { type: "load"; count: number }
  | { type: "toggle" }
  | { type: "pause" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "speed"; speed: 0.5 | 1 }
  | { type: "view"; view: 0 | 1 }
  | { type: "stop" }
  | { type: "resume" }
  | { type: "finished" }
  | { type: "hud"; hud: StageHud }
  | { type: "pace"; pace: StagePace }
  | { type: "voice"; on: boolean }
  | { type: "release"; step: string };

export function initialStageState(count: number, stopped = false): StageState {
  return {
    index: 0,
    count,
    playing: false,
    speed: 1,
    stopped,
    view: { id: 0, view: null },
    restartKey: 0,
    hud: null,
    pace: "guided",
    voiceOn: true,
    release: { id: 0, step: null },
  };
}

/**
 * Whether spoken instructions are actually on. Real-time pace never speaks;
 * voiceOn keeps the user's Guided choice so switching back restores it.
 */
export function speechEnabled(state: Pick<StageState, "pace" | "voiceOn">): boolean {
  return state.pace === "guided" && state.voiceOn;
}

export function stageReducer(state: StageState, action: StageAction): StageState {
  switch (action.type) {
    case "load":
      return {
        ...state,
        count: action.count,
        index: 0,
        playing: false,
        hud: null,
        restartKey: state.restartKey + 1,
        view: { id: state.view.id + 1, view: null },
      };
    case "toggle":
      if (state.stopped || state.count === 0) return state;
      // Play after the end replays the exercise from the start.
      if (!state.playing && state.hud?.done) {
        return { ...state, playing: true, hud: null, restartKey: state.restartKey + 1 };
      }
      return { ...state, playing: !state.playing };
    case "pause":
      return { ...state, playing: false };
    case "next":
    case "prev": {
      if (state.stopped || state.count === 0) return state;
      const step = action.type === "next" ? 1 : -1;
      const index = Math.min(state.count - 1, Math.max(0, state.index + step));
      if (index === state.index) return state;
      return { ...state, index, playing: false, hud: null, restartKey: state.restartKey + 1, view: { id: state.view.id + 1, view: null } };
    }
    case "speed":
      return { ...state, speed: action.speed };
    case "view":
      return { ...state, view: { id: state.view.id + 1, view: action.view } };
    case "stop":
      return { ...state, playing: false, stopped: true };
    case "resume":
      return { ...state, stopped: false, playing: false, hud: null, restartKey: state.restartKey + 1 };
    case "finished":
      return { ...state, playing: false };
    case "hud":
      return { ...state, hud: action.hud };
    case "pace":
      return { ...state, pace: action.pace };
    case "voice":
      return { ...state, voiceOn: action.on };
    case "release":
      return { ...state, release: { id: state.release.id + 1, step: action.step } };
    default:
      return state;
  }
}

export function useStageController(count: number, stopped: boolean) {
  const [state, dispatch] = useReducer(stageReducer, undefined, () => initialStageState(count, stopped));
  const act = useCallback((action: StageAction) => dispatch(action), []);
  return { state, dispatch: act };
}
