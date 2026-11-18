// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { MotionEngine } from "@/lib/kinematics/engine";
import { normalizeSpec, type MovementSpec } from "@/lib/kinematics/movement-spec";
import { loadBodyRigNode } from "@/lib/kinematics/node-body";
import { REFERENCE_EXERCISES } from "@/lib/kinematics/reference-exercises";
import { safeProgress } from "@/lib/kinematics/solver";
import { sampleTimeline } from "@/lib/kinematics/timeline";
import type { AngleReading } from "@/lib/kinematics/angles";
import type { BodyRig } from "@/lib/kinematics/rig";

let rig: BodyRig;
let engine: MotionEngine;

beforeAll(async () => {
  rig = await loadBodyRigNode();
  engine = new MotionEngine(rig);
});

const spec = (id: string): MovementSpec => {
  const found = REFERENCE_EXERCISES.find((exercise) => exercise.id === id);
  if (!found) throw new Error(id);
  return normalizeSpec(found.spec).spec;
};

/** Load an exercise and play it to `seconds` at the given speed in small frames. */
function playTo(exercise: MovementSpec, seconds: number, speed = 1) {
  engine.setExercise(exercise);
  const step = 1 / 60;
  let clock = 0;
  while (clock + step * speed <= seconds + 1e-9) {
    engine.update(step, true, speed);
    clock += step * speed;
  }
  if (seconds - clock > 1e-9) engine.update((seconds - clock) / speed, true, speed);
}

const readingsById = () => new Map(engine.measureAngles().map((reading) => [reading.id, reading]));
const labelNames = () => (engine.angleTrack?.labels ?? []).map((label) => label.name);

/** Peak time inside the first rep: the middle of the hold. */
const holdTime = (exercise: MovementSpec) => exercise.tempo.upSeconds + exercise.tempo.holdSeconds / 2;
/** Half way through the first lift; minimum-jerk easing is exactly 0.5 there. */
const midLiftTime = (exercise: MovementSpec) => exercise.tempo.upSeconds / 2;

function get(readings: Map<string, AngleReading>, id: string) {
  const reading = readings.get(id);
  if (!reading) throw new Error(`${id} is not tracked; tracked: ${[...readings.keys()].join(", ")}`);
  return reading;
}

describe("Supine Pelvic Tilt (a subtle movement)", () => {
  const tilt = spec("supine_pelvic_tilt");

  it("finds the pelvis, lumbar spine and both hips without being told which joints move", () => {
    playTo(tilt, 0);
    const ids = engine.angleTrack?.joints.map((joint) => joint.id).sort();
    expect(ids).toEqual(["hipL", "hipR", "lumbar", "pelvis"]);
    expect(labelNames()).toEqual(["Lumbar flexion", "Posterior pelvic tilt", "Hip extension"]);
    // Both hips move the same amount, so they share one label.
    expect(engine.angleTrack?.labels.find((label) => label.key === "hip")?.side).toBe("L+R");
  });

  it("reads 0° at the start pose", () => {
    playTo(tilt, 0);
    for (const reading of engine.measureAngles()) expect(reading.degrees).toBeLessThan(0.01);
  });

  it("reads the peak in the hold, matching the prescription", () => {
    playTo(tilt, holdTime(tilt));
    const readings = readingsById();
    const safe = safeProgress(rig, tilt, false);
    playTo(tilt, holdTime(tilt));
    // Prescribed: posterior tilt 10° and lumbar flexion 6°. The lumbar spine
    // also flexes relative to the pelvis by the whole tilt, so it reads 16°.
    // The pelvis is read against the floor, and the solver re-pitches the body
    // a little to keep the back and feet on the mat, so it reads slightly more.
    const pelvis = get(readings, "pelvis").degrees;
    expect(pelvis).toBeGreaterThan(10 * safe - 0.1);
    expect(pelvis).toBeLessThan(10 * safe + 1.5);
    expect(get(readings, "lumbar").degrees).toBeCloseTo(16 * safe, 0);
    expect(get(readings, "hipL").degrees).toBeCloseTo(10 * safe, 0);
    for (const reading of readings.values()) expect(reading.degrees).toBeCloseTo(reading.peakDegrees, 1);
  });

  it("reads half the excursion half way through the lift", () => {
    playTo(tilt, midLiftTime(tilt));
    for (const reading of engine.measureAngles()) {
      expect(reading.degrees).toBeGreaterThan(reading.peakDegrees * 0.45);
      expect(reading.degrees).toBeLessThan(reading.peakDegrees * 0.55);
    }
  });

  it("agrees with the pelvis bone's own orientation, measured independently", () => {
    playTo(tilt, 0);
    const start = rig.bones.pelvis.getWorldQuaternion(new Quaternion());
    playTo(tilt, holdTime(tilt));
    const now = rig.bones.pelvis.getWorldQuaternion(new Quaternion());
    const turned = 2 * Math.acos(Math.min(1, Math.abs(now.multiply(start.invert()).w))) * (180 / Math.PI);
    expect(get(readingsById(), "pelvis").degrees).toBeCloseTo(turned, 1);
  });

  it("stays locked to the motion at 0.5x speed and while paused", () => {
    playTo(tilt, midLiftTime(tilt), 1);
    const normal = get(readingsById(), "pelvis").degrees;
    playTo(tilt, midLiftTime(tilt), 0.5);
    expect(get(readingsById(), "pelvis").degrees).toBeCloseTo(normal, 2);

    engine.update(0.5, false, 1);
    expect(get(readingsById(), "pelvis").degrees).toBeCloseTo(normal, 6);
  });

  it("returns to 0° in the rest between reps and resets when the exercise changes", () => {
    const { upSeconds, holdSeconds, downSeconds, restSeconds } = tilt.tempo;
    playTo(tilt, upSeconds + holdSeconds + downSeconds + restSeconds / 2);
    expect(sampleTimeline(tilt, engine.time).phase).toBe("rest");
    for (const reading of engine.measureAngles()) expect(reading.degrees).toBeLessThan(0.05);

    const version = engine.angleTrackVersion;
    playTo(spec("cat_cow"), 0);
    expect(engine.angleTrackVersion).toBeGreaterThan(version);
    expect(labelNames()).toContain("Thoracic flexion");
  });

  it("draws the arms in the plane of motion: the live arm reaches the peak angle from the start arm", () => {
    playTo(tilt, holdTime(tilt));
    for (const reading of engine.measureAngles()) {
      expect(Math.abs(reading.ref.dot(reading.normal))).toBeLessThan(1e-6);
      expect(Math.abs(reading.live.dot(reading.normal))).toBeLessThan(0.02);
      expect(reading.signedDegrees).toBeGreaterThan(0);
    }
  });
});

describe("Cat-Cow (several spinal segments)", () => {
  const catCow = spec("cat_cow");

  it("tracks each spinal segment and names it", () => {
    playTo(catCow, 0);
    expect(labelNames()).toEqual(
      expect.arrayContaining(["Lumbar flexion", "Thoracic flexion", "Neck flexion", "Posterior pelvic tilt"]),
    );
    for (const reading of engine.measureAngles()) expect(reading.degrees).toBeLessThan(0.01);
  });

  it("reads each segment's excursion from the cow (extended) start to the cat (flexed) peak", () => {
    const safe = safeProgress(rig, catCow, false);
    playTo(catCow, holdTime(catCow));
    const readings = readingsById();
    // The model shares lumbar flexion between two vertebrae and 30% of
    // thoracic flexion with the lower one: lumbar (12 + 30) + 0.3 x (10 + 22).
    expect(get(readings, "lumbar").degrees).toBeCloseTo(51.6 * safe, 0);
    // The upper thoracic vertebra takes the other 70%: 0.7 x (10 + 22).
    expect(get(readings, "thoracic").degrees).toBeCloseTo(22.4 * safe, 0);
    // Neck: 15° extension to 20° flexion.
    expect(get(readings, "cervical").degrees).toBeCloseTo(35 * safe, 0);
  });

  it("reads half way through the movement at mid lift", () => {
    playTo(catCow, midLiftTime(catCow));
    const readings = readingsById();
    for (const id of ["lumbar", "thoracic", "cervical"]) {
      const reading = get(readings, id);
      expect(reading.degrees / reading.peakDegrees).toBeCloseTo(0.5, 1);
    }
  });
});

describe("Bird Dog (opposite arm and leg, alternating sides)", () => {
  const birdDog = spec("bird_dog");

  it("tracks the reaching arm, the extending hip and knee, and switches side on the next rep", () => {
    playTo(birdDog, 0);
    expect(engine.angleTrack?.labels.map((label) => `${label.side} ${label.name}`)).toEqual([
      "L Knee extension",
      "L Hip extension",
      "R Shoulder flexion",
    ]);
    for (const reading of engine.measureAngles()) expect(reading.degrees).toBeLessThan(0.01);

    const { upSeconds, holdSeconds, downSeconds, restSeconds } = birdDog.tempo;
    const rep = upSeconds + holdSeconds + downSeconds + restSeconds;
    playTo(birdDog, rep + holdTime(birdDog));
    expect(engine.angleTrack?.labels.map((label) => `${label.side} ${label.name}`)).toEqual([
      "R Knee extension",
      "R Hip extension",
      "L Shoulder flexion",
    ]);
  });

  it("reads the peaks: knee 105° to straight, hip 90° flexion to 10° extension, shoulder 90° to 144°", () => {
    const safe = safeProgress(rig, birdDog, false);
    playTo(birdDog, holdTime(birdDog));
    const readings = readingsById();
    expect(get(readings, "kneeL").degrees).toBeCloseTo(105 * safe, 0);
    expect(get(readings, "hipL").degrees).toBeCloseTo(100 * safe, 0);
    expect(get(readings, "shoulderR").degrees).toBeGreaterThan(50 * safe);
    expect(get(readings, "shoulderR").degrees).toBeLessThan(58 * safe);
  });

  it("reads half of each excursion at mid lift", () => {
    playTo(birdDog, midLiftTime(birdDog));
    const readings = readingsById();
    for (const id of ["kneeL", "hipL", "shoulderR"]) {
      const reading = get(readings, id);
      expect(reading.degrees / reading.peakDegrees).toBeCloseTo(0.5, 1);
    }
  });
});

describe("every reference exercise", () => {
  // Segment of a prescribed motion, as the joint that measures it.
  const jointFor = (segment: string, side: "L" | "R" | null) => {
    const kind = segment === "forearm" ? "elbow" : segment;
    return ["cervical", "thoracic", "lumbar", "pelvis"].includes(kind) ? kind : `${kind}${side}`;
  };

  it.each(REFERENCE_EXERCISES.map((exercise) => [exercise.name, exercise.id]))(
    "%s: tracks at least one joint, starts at 0° and only shows real numbers",
    (_name, id) => {
      const exercise = spec(id);
      playTo(exercise, 0);
      const track = engine.angleTrack;
      expect(track?.labels.length).toBeGreaterThan(0);
      for (const reading of engine.measureAngles()) {
        expect(Number.isFinite(reading.degrees)).toBe(true);
        expect(reading.degrees).toBeLessThan(0.01);
      }

      // Every large prescribed motion is shown on the joint that makes it.
      const tracked = new Set(track?.joints.map((joint) => joint.id));
      for (const entry of exercise.movements) {
        const start = exercise.startPose.find((e) => e.segment === entry.segment && e.side === entry.side);
        if (start && Math.abs(start.degrees - entry.degrees) < 8) continue;
        if (entry.degrees < 8 && !start) continue;
        const sides: Array<"L" | "R" | null> =
          ["cervical", "thoracic", "lumbar", "pelvis"].includes(entry.segment)
            ? [null]
            : entry.side === "left"
              ? ["L"]
              : entry.side === "right"
                ? ["R"]
                : ["L", "R"];
        for (const side of sides) expect(tracked).toContain(jointFor(entry.segment, side));
      }

      playTo(exercise, holdTime(exercise));
      for (const reading of engine.measureAngles()) {
        expect(reading.degrees).toBeGreaterThan(0);
        expect(reading.degrees).toBeLessThanOrEqual(180);
      }
    },
  );
});

describe("readings are geometry, not labels", () => {
  it("places each protractor at its joint", () => {
    playTo(spec("bird_dog"), holdTime(spec("bird_dog")));
    const knee = get(readingsById(), "kneeL");
    expect(knee.pivot.distanceTo(rig.bones.calfL.getWorldPosition(new Vector3()))).toBeLessThan(1e-9);
  });
});
