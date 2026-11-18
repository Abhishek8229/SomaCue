import type { Phase } from "@/lib/kinematics/timeline";
import type { Posture, Region } from "@/lib/kinematics/vocabulary";

export type StageStatus = "loading" | "ready" | "error";

/** What the canvas reports back a few times per second. */
export type StageHud = {
  rep: number;
  set: number;
  phase: Phase | null;
  elapsed: number;
  total: number;
  done: boolean;
  posture: Posture;
  /** seconds left in the current phase */
  phaseRemaining: number;
  /** a mirrored rep of an alternating exercise (the other side) */
  mirrored: boolean;
  /** stable id of the current step */
  stepKey: string;
  /** guided pace: the step the figure is waiting to perform, or null */
  waitingStep: string | null;
  /** live joint angles of the 3D model, one per label (empty while stopped) */
  angles?: StageAngle[];
};

export type StageAngle = {
  key: string;
  side: "L" | "R" | "L+R" | null;
  name: string;
  short: string;
  degrees: number;
};

export type StageViewCommand = { id: number; view: 0 | 1 };

export type StageGlow = {
  /** regions of the exercise being shown */
  active: Region[];
  /** regions reported in a Pain Override, shown in red */
  pain: Region[];
  /** regions flagged in earlier feedback, shown in amber */
  flagged: Region[];
};
