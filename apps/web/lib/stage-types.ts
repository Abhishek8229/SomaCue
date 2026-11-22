export type ModelStatus = "loading" | "ready" | "error";

export type ViewCommandType =
  | "front"
  | "side"
  | "back"
  | "reset"
  | "zoom-in"
  | "zoom-out";

export type ViewCommand = {
  id: number;
  type: ViewCommandType;
};

export type SeekCommand = {
  id: number;
  seconds: number;
};
