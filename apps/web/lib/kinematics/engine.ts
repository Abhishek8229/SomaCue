import { Box3, Vector3 } from "three";
import { buildAngleTrack, measureAngles, type AngleReading, type AngleTrack } from "./angles";
import {
  lerpPose,
  mirrorRegions,
  type DofPose,
  type MovementSpec,
} from "./movement-spec";
import { POSTURE_DEFS } from "./postures";
import { sampleVertices, type BodyRig } from "./rig";
import {
  basePose,
  endPose,
  poseAt,
  prepareMovement,
  safeProgress,
  secondaryInContact,
  solvePose,
  startPose,
  type SolveSetup,
} from "./solver";
import { minimumJerk, sampleTimeline, type TimelineSample } from "./timeline";
import type { Posture, Region } from "./vocabulary";

const REST_BLEND_SECONDS = 0.6;

type SideState = { setup: SolveSetup; safe: number };

export type EngineFrame = {
  sample: TimelineSample | null;
  activeRegions: Region[];
  posture: Posture;
  resting: boolean;
  /** guided pace: the step the figure is waiting to perform, until released */
  waitingStep: string | null;
};

/** Small step past a boundary so the sample lands inside the new step. */
const BOUNDARY_EPSILON = 1e-4;

/**
 * Drives the body from a movement spec in real time. No React here: the stage
 * component owns the clock and calls update() once per animation frame.
 */
export class MotionEngine {
  readonly rig: BodyRig;
  private spec: MovementSpec | null = null;
  private sides: [SideState, SideState] | null = null;
  private elapsed = 0;
  private posture: Posture = "standing";
  private lastPose: DofPose = {};
  private rest: { from: DofPose; t: number; setup: SolveSetup } | null = null;
  private lastSample: TimelineSample | null = null;
  /** guided pace: hold at the start of each step until the step is released */
  private guided = false;
  private released = new Set<string>();
  private waiting: string | null = null;
  /** joints that move in this exercise, per side (normal, mirrored) */
  private tracks: [AngleTrack, AngleTrack] | null = null;
  private trackVersion = 0;

  constructor(rig: BodyRig) {
    this.rig = rig;
    this.setExercise(null);
  }

  /** Load an exercise (or null for a neutral standing figure). Resets the clock. */
  setExercise(spec: MovementSpec | null) {
    this.spec = spec;
    this.elapsed = 0;
    this.rest = null;
    this.lastSample = null;
    this.released.clear();
    this.waiting = null;
    this.posture = spec?.posture ?? "standing";
    if (spec) {
      const make = (mirrored: boolean): SideState => ({
        safe: safeProgress(this.rig, spec, mirrored),
        setup: prepareMovement(this.rig, spec, mirrored),
      });
      const normal = make(false);
      this.sides = [normal, spec.alternateSides ? make(true) : normal];
      const track = (mirrored: boolean) => {
        const side = (this.sides as [SideState, SideState])[mirrored ? 1 : 0];
        return buildAngleTrack(
          this.rig,
          (progress) => solvePose(this.rig, spec.posture, poseAt(spec, progress * side.safe, mirrored), side.setup),
          { start: startPose(spec, mirrored), end: endPose(spec, mirrored) },
        );
      };
      const first = track(false);
      this.tracks = [first, spec.alternateSides ? track(true) : first];
    } else {
      this.sides = null;
      this.tracks = null;
    }
    this.trackVersion += 1;
    this.solveAt(0);
  }

  /** Changes whenever the set of tracked joints may have changed. */
  get angleTrackVersion() {
    return this.trackVersion;
  }

  /** Both sides' tracked joints, for building the overlays once per exercise. */
  get angleTracks() {
    return this.tracks;
  }

  /** Tracked joints for the side shown now; none while easing to rest. */
  get angleTrack(): AngleTrack | null {
    if (!this.tracks || this.rest) return null;
    return this.tracks[this.lastSample?.mirrored ? 1 : 0];
  }

  /** Live joint angles of the pose the rig is in now. */
  measureAngles(): AngleReading[] {
    const track = this.angleTrack;
    return track ? measureAngles(track) : [];
  }

  get currentSpec() {
    return this.spec;
  }

  get time() {
    return this.elapsed;
  }

  /** Jump back to the start of the exercise. */
  restart() {
    this.elapsed = 0;
    this.rest = null;
    this.released.clear();
    this.waiting = null;
    this.solveAt(0);
  }

  /**
   * Guided pace: before each step (move, hold, return, rest) the figure waits
   * at the step's first frame until release() is called for it, for example
   * when the spoken instruction has finished. Real-time pace never waits.
   */
  setGuided(guided: boolean) {
    this.guided = guided;
    if (!guided) this.waiting = null;
  }

  /** Let the figure perform a step it is waiting at. */
  release(stepKey: string) {
    this.released.add(stepKey);
    if (this.waiting === stepKey) this.waiting = null;
  }

  get waitingStep() {
    return this.waiting;
  }

  /**
   * Abort: ease from the current pose to the posture's relaxed resting pose.
   * A lying figure stays lying, a standing figure stays standing.
   */
  stopToRest() {
    const posture = this.posture;
    const pose = basePose(posture);
    const secondary = secondaryInContact(this.rig, posture, pose);
    this.rest = { from: { ...this.lastPose }, t: 0, setup: { secondary, planted: {}, pins: [] } };
  }

  get isResting() {
    return this.rest !== null;
  }

  /** Advance by `delta` seconds (0 when paused) and solve the body. */
  update(delta: number, playing: boolean, speed: number): EngineFrame {
    if (this.rest) {
      this.rest.t = Math.min(1, this.rest.t + delta / REST_BLEND_SECONDS);
      const pose = lerpPose(this.rest.from, basePose(this.posture), minimumJerk(this.rest.t));
      solvePose(this.rig, this.posture, pose, this.rest.setup);
      this.lastPose = pose;
      return { sample: this.lastSample, activeRegions: [], posture: this.posture, resting: true, waitingStep: null };
    }

    if (playing && this.spec) this.elapsed = this.advance(this.elapsed, delta * speed);
    const sample = this.solveAt(this.elapsed);
    this.lastSample = sample;
    const regions = this.spec ? mirrorRegions(this.spec.targetRegions, sample?.mirrored ?? false) : [];
    return { sample, activeRegions: regions, posture: this.posture, resting: false, waitingStep: this.waiting };
  }

  /**
   * Next clock time. In guided pace the clock stops at the first frame of any
   * step that has not been released, so the pose waits there without a jump.
   */
  private advance(from: number, step: number) {
    if (!this.spec) return from;
    if (!this.guided) return from + step;
    const current = sampleTimeline(this.spec, from);
    if (current.stepKey !== "done" && !this.released.has(current.stepKey)) {
      this.waiting = current.stepKey;
      return from;
    }
    const next = sampleTimeline(this.spec, from + step);
    if (next.stepKey === current.stepKey || next.stepKey === "done" || this.released.has(next.stepKey)) {
      return from + step;
    }
    // Crossed into a step that has not been released: stop at its start.
    this.waiting = next.stepKey;
    return Math.max(from, next.phaseStart + BOUNDARY_EPSILON);
  }

  private solveAt(elapsed: number): TimelineSample | null {
    if (!this.spec || !this.sides) {
      const pose = basePose("standing");
      solvePose(this.rig, "standing", pose, { secondary: false, planted: {}, pins: [] });
      this.lastPose = pose;
      return null;
    }
    const sample = sampleTimeline(this.spec, elapsed);
    const side = this.sides[sample.mirrored ? 1 : 0];
    const pose = poseAt(this.spec, sample.progress * side.safe, sample.mirrored);
    solvePose(this.rig, this.spec.posture, pose, side.setup);
    this.lastPose = pose;
    return sample;
  }

  /**
   * Bounding sphere of the body over the whole movement, used to frame the
   * camera once per exercise so it does not chase the figure.
   */
  movementBounds() {
    const box = new Box3();
    const point = new Vector3();
    const include = () => {
      sampleVertices(this.rig.mesh, this.rig.sampler);
      const w = this.rig.sampler.world;
      for (let i = 0; i < w.length; i += 9) box.expandByPoint(point.set(w[i], w[i + 1], w[i + 2]));
    };
    if (this.spec && this.sides) {
      for (const mirrored of this.spec.alternateSides ? [false, true] : [false]) {
        const side = this.sides[mirrored ? 1 : 0];
        for (const progress of [0, 0.5, 1]) {
          solvePose(this.rig, this.spec.posture, poseAt(this.spec, progress * side.safe, mirrored), side.setup);
          include();
        }
      }
      this.solveAt(this.elapsed);
    } else {
      include();
    }
    if (POSTURE_DEFS[this.posture].support === "seat") box.expandByPoint(point.set(0, 0, 0));
    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() / 2;
    return { center, radius: Math.max(0.6, radius) };
  }
}
