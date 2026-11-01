import { Quaternion, Vector3 } from "three";
import {
  partCentroid,
  partEndCentroid,
  requirePart,
  type AtlasData,
} from "./atlas-loader";
import type { LabRig } from "./lab-rig";
import type { AxisRow, LandmarkRow, SegmentRow, Vec3 } from "./lab-types";

type Side = "L" | "R";
const SIDES: Side[] = ["L", "R"];
const sideWord = (side: Side) => (side === "L" ? "Left" : "Right");
const sideLower = (side: Side) => (side === "L" ? "left" : "right");

const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);
const v3 = (p: Vec3) => new Vector3(p[0], p[1], p[2]);

type LandmarkDef = {
  id: string;
  label: string;
  rigBone: (side: Side | "") => string;
  atlas: (atlas: AtlasData, side: Side | "") => Vector3;
  paired: boolean;
};

/**
 * Joint landmarks present in both models. Atlas landmarks are estimated from
 * bone geometry (bone-end centroids), so each carries roughly 5 to 15 mm of
 * uncertainty; rig landmarks are the bone origins.
 */
export const LANDMARKS: LandmarkDef[] = [
  {
    id: "hip",
    label: "Hip joint",
    paired: true,
    rigBone: (s) => `upperleg01.${s}`,
    atlas: (a, s) =>
      v3(
        partEndCentroid(
          requirePart(a, `${sideWord(s as Side)} femur`),
          "top",
          0.1,
        ),
      ),
  },
  {
    id: "knee",
    label: "Knee",
    paired: true,
    rigBone: (s) => `lowerleg01.${s}`,
    atlas: (a, s) =>
      mid(
        v3(
          partEndCentroid(
            requirePart(a, `${sideWord(s as Side)} femur`),
            "bottom",
            0.06,
          ),
        ),
        v3(
          partEndCentroid(
            requirePart(a, `${sideWord(s as Side)} tibia`),
            "top",
            0.06,
          ),
        ),
      ),
  },
  {
    id: "ankle",
    label: "Ankle",
    paired: true,
    rigBone: (s) => `foot.${s}`,
    atlas: (a, s) =>
      v3(partCentroid(requirePart(a, `${sideWord(s as Side)} talus`))),
  },
  {
    id: "toe",
    label: "Second toe, distal",
    paired: true,
    rigBone: (s) => `toe2-3.${s}`,
    atlas: (a, s) =>
      v3(
        partCentroid(
          requirePart(
            a,
            `Distal phalanx of ${sideLower(s as Side)} second toe`,
          ),
        ),
      ),
  },
  {
    id: "shoulder",
    label: "Shoulder joint",
    paired: true,
    rigBone: (s) => `upperarm01.${s}`,
    atlas: (a, s) =>
      v3(
        partEndCentroid(
          requirePart(a, `${sideWord(s as Side)} humerus`),
          "top",
          0.15,
        ),
      ),
  },
  {
    id: "elbow",
    label: "Elbow",
    paired: true,
    rigBone: (s) => `lowerarm01.${s}`,
    atlas: (a, s) =>
      mid(
        v3(
          partEndCentroid(
            requirePart(a, `${sideWord(s as Side)} humerus`),
            "bottom",
            0.08,
          ),
        ),
        v3(
          partEndCentroid(
            requirePart(a, `${sideWord(s as Side)} ulna`),
            "top",
            0.1,
          ),
        ),
      ),
  },
  {
    id: "wrist",
    label: "Wrist",
    paired: true,
    rigBone: (s) => `wrist.${s}`,
    atlas: (a, s) =>
      mid(
        v3(
          partEndCentroid(
            requirePart(a, `${sideWord(s as Side)} radius`),
            "bottom",
            0.08,
          ),
        ),
        v3(
          partEndCentroid(
            requirePart(a, `${sideWord(s as Side)} ulna`),
            "bottom",
            0.08,
          ),
        ),
      ),
  },
  {
    id: "finger",
    label: "Middle finger, distal",
    paired: true,
    rigBone: (s) => `finger3-3.${s}`,
    atlas: (a, s) =>
      v3(
        partCentroid(
          requirePart(
            a,
            `Distal phalanx of ${sideLower(s as Side)} middle finger`,
          ),
        ),
      ),
  },
  {
    id: "skullBase",
    label: "Skull base (atlas vertebra C1)",
    paired: false,
    rigBone: () => "head",
    atlas: (a) => v3(partCentroid(requirePart(a, "Atlas"))),
  },
  {
    id: "neck",
    label: "Cervical spine base (C7)",
    paired: false,
    rigBone: () => "neck01",
    atlas: (a) => v3(partCentroid(requirePart(a, "Seventh cervical vertebra"))),
  },
];

export type LandmarkSet = Map<string, Vector3>;

const key = (def: LandmarkDef, side: Side | "") =>
  def.paired ? `${def.id}.${side}` : def.id;

export function atlasLandmarks(atlas: AtlasData): LandmarkSet {
  const set: LandmarkSet = new Map();
  for (const def of LANDMARKS) {
    if (def.paired)
      for (const side of SIDES) set.set(key(def, side), def.atlas(atlas, side));
    else set.set(key(def, ""), def.atlas(atlas, ""));
  }
  return set;
}

export function rigLandmarks(rig: LabRig): LandmarkSet {
  rig.scene.updateMatrixWorld(true);
  const set: LandmarkSet = new Map();
  for (const def of LANDMARKS) {
    const add = (side: Side | "") =>
      set.set(
        key(def, side),
        rig.bone(def.rigBone(side)).getWorldPosition(new Vector3()),
      );
    if (def.paired) for (const side of SIDES) add(side);
    else add("");
  }
  return set;
}

export function landmarkLabel(id: string): string {
  const [base, side] = id.split(".");
  const def = LANDMARKS.find((entry) => entry.id === base);
  return `${def?.label ?? base}${side ? ` (${side})` : ""}`;
}

/** Axis agreement: up, front and left, each defined by landmarks in both models. */
export function orientationAxes(
  atlas: LandmarkSet,
  rig: LandmarkSet,
): AxisRow[] {
  const rows: AxisRow[] = [];
  const axis = (
    id: string,
    label: string,
    fn: (set: LandmarkSet) => Vector3,
  ) => {
    const a = fn(atlas).normalize();
    const r = fn(rig).normalize();
    const angle =
      (Math.acos(Math.min(1, Math.max(-1, a.dot(r)))) * 180) / Math.PI;
    rows.push({
      id,
      label,
      atlas: a.toArray() as Vec3,
      rig: r.toArray() as Vec3,
      agreeDeg: angle,
    });
  };
  const g = (set: LandmarkSet, id: string) => set.get(id) as Vector3;
  axis("up", "Up: ankles to neck", (set) =>
    g(set, "neck")
      .clone()
      .sub(mid(g(set, "ankle.L"), g(set, "ankle.R"))),
  );
  axis("front", "Front: ankle to toe (level)", (set) => {
    const d = mid(g(set, "toe.L"), g(set, "toe.R")).sub(
      mid(g(set, "ankle.L"), g(set, "ankle.R")),
    );
    d.y = 0;
    return d;
  });
  axis("left", "Subject left: right shoulder to left shoulder", (set) =>
    g(set, "shoulder.L").clone().sub(g(set, "shoulder.R")),
  );
  return rows;
}

const SEGMENTS: Array<{
  id: string;
  label: string;
  a: string;
  b: string;
  paired: boolean;
}> = [
  {
    id: "thigh",
    label: "Thigh (hip to knee)",
    a: "hip",
    b: "knee",
    paired: true,
  },
  {
    id: "shank",
    label: "Shank (knee to ankle)",
    a: "knee",
    b: "ankle",
    paired: true,
  },
  {
    id: "foot",
    label: "Foot (ankle to toe)",
    a: "ankle",
    b: "toe",
    paired: true,
  },
  {
    id: "upperArm",
    label: "Upper arm (shoulder to elbow)",
    a: "shoulder",
    b: "elbow",
    paired: true,
  },
  {
    id: "forearm",
    label: "Forearm (elbow to wrist)",
    a: "elbow",
    b: "wrist",
    paired: true,
  },
  {
    id: "hand",
    label: "Hand (wrist to fingertip)",
    a: "wrist",
    b: "finger",
    paired: true,
  },
];

export function segmentRows(
  atlas: LandmarkSet,
  rig: LandmarkSet,
): SegmentRow[] {
  const rows: SegmentRow[] = [];
  const g = (set: LandmarkSet, id: string) => set.get(id) as Vector3;
  for (const seg of SEGMENTS) {
    for (const side of SIDES) {
      const aLen = g(atlas, `${seg.a}.${side}`).distanceTo(
        g(atlas, `${seg.b}.${side}`),
      );
      const rLen = g(rig, `${seg.a}.${side}`).distanceTo(
        g(rig, `${seg.b}.${side}`),
      );
      rows.push({
        id: `${seg.id}.${side}`,
        label: `${seg.label} (${side})`,
        atlasM: aLen,
        rigM: rLen,
        ratio: aLen / rLen,
      });
    }
  }
  const width = (set: LandmarkSet, id: string) =>
    g(set, `${id}.L`).distanceTo(g(set, `${id}.R`));
  for (const [id, label] of [
    ["shoulder", "Shoulder joint width"],
    ["hip", "Hip joint width"],
  ] as const) {
    const aLen = width(atlas, id);
    const rLen = width(rig, id);
    rows.push({
      id: `${id}Width`,
      label,
      atlasM: aLen,
      rigM: rLen,
      ratio: aLen / rLen,
    });
  }
  const trunk = (set: LandmarkSet) =>
    g(set, "neck").distanceTo(mid(g(set, "hip.L"), g(set, "hip.R")));
  rows.push({
    id: "trunk",
    label: "Trunk (hip centre to C7)",
    atlasM: trunk(atlas),
    rigM: trunk(rig),
    ratio: trunk(atlas) / trunk(rig),
  });
  return rows;
}

/** Least-squares uniform scale and translation mapping atlas points onto rig points. */
export function fitUniform(
  atlas: LandmarkSet,
  rig: LandmarkSet,
): { scale: number; translation: Vector3 } {
  const ids = [...atlas.keys()];
  const ac = new Vector3();
  const rc = new Vector3();
  for (const id of ids) {
    ac.add(atlas.get(id) as Vector3);
    rc.add(rig.get(id) as Vector3);
  }
  ac.multiplyScalar(1 / ids.length);
  rc.multiplyScalar(1 / ids.length);
  let num = 0;
  let den = 0;
  for (const id of ids) {
    const a = (atlas.get(id) as Vector3).clone().sub(ac);
    const r = (rig.get(id) as Vector3).clone().sub(rc);
    num += a.dot(r);
    den += a.dot(a);
  }
  const scale = num / den;
  return {
    scale,
    translation: rc.clone().sub(ac.clone().multiplyScalar(scale)),
  };
}

export function landmarkRows(
  atlas: LandmarkSet,
  rig: LandmarkSet,
  fit: { scale: number; translation: Vector3 },
): LandmarkRow[] {
  return [...atlas.keys()].map((id) => {
    const a = atlas.get(id) as Vector3;
    const r = rig.get(id) as Vector3;
    const mapped = a.clone().multiplyScalar(fit.scale).add(fit.translation);
    return {
      id,
      label: landmarkLabel(id),
      atlas: mapped.toArray() as Vec3,
      rig: r.toArray() as Vec3,
      errorMm: mapped.distanceTo(r) * 1000,
    };
  });
}

/**
 * Residual rotation between the centred landmark clouds, estimated per plane
 * (2D Procrustes). Degrees. Small values mean no re-orientation is needed.
 */
export function residualRotation(
  atlas: LandmarkSet,
  rig: LandmarkSet,
): { yaw: number; pitch: number; roll: number } {
  const ids = [...atlas.keys()];
  const ac = new Vector3();
  const rc = new Vector3();
  for (const id of ids) {
    ac.add(atlas.get(id) as Vector3);
    rc.add(rig.get(id) as Vector3);
  }
  ac.multiplyScalar(1 / ids.length);
  rc.multiplyScalar(1 / ids.length);
  const plane = (i: number, j: number) => {
    let cross = 0;
    let dot = 0;
    for (const id of ids) {
      const a = (atlas.get(id) as Vector3).clone().sub(ac);
      const r = (rig.get(id) as Vector3).clone().sub(rc);
      const ai = a.getComponent(i);
      const aj = a.getComponent(j);
      const ri = r.getComponent(i);
      const rj = r.getComponent(j);
      cross += ai * rj - aj * ri;
      dot += ai * ri + aj * rj;
    }
    return (Math.atan2(cross, dot) * 180) / Math.PI;
  };
  return { yaw: plane(0, 2), pitch: plane(1, 2), roll: plane(0, 1) };
}

const NECK_CHAIN = {
  bones: ["neck01", "head"],
  landmarks: ["neck", "skullBase"],
};

const CHAINS = (side: Side) => [
  {
    bones: [
      `upperarm01.${side}`,
      `lowerarm01.${side}`,
      `wrist.${side}`,
      `finger3-3.${side}`,
    ],
    landmarks: [
      `shoulder.${side}`,
      `elbow.${side}`,
      `wrist.${side}`,
      `finger.${side}`,
    ],
  },
  {
    bones: [
      `upperleg01.${side}`,
      `lowerleg01.${side}`,
      `foot.${side}`,
      `toe2-3.${side}`,
    ],
    landmarks: [`hip.${side}`, `knee.${side}`, `ankle.${side}`, `toe.${side}`],
  },
];

/**
 * Pose the rig's neck and limbs so each segment points where the atlas segment points.
 * Directions come from atlas landmark differences, so no fit is needed first.
 * Returns the upper-arm abduction angle (from straight down) before and after.
 */
export function matchLimbsToAtlas(
  rig: LabRig,
  atlas: LandmarkSet,
): { before: number; after: number; atlasDeg: number } {
  const down = new Vector3(0, -1, 0);
  const abduction = (dir: Vector3) =>
    (Math.acos(Math.min(1, Math.max(-1, dir.clone().normalize().dot(down)))) *
      180) /
    Math.PI;
  const pos = (name: string) => rig.bone(name).getWorldPosition(new Vector3());

  rig.scene.updateMatrixWorld(true);
  const armDir = () => pos("lowerarm01.L").sub(pos("upperarm01.L"));
  const before = abduction(armDir());
  const atlasL = atlas.get("elbow.L")!.clone().sub(atlas.get("shoulder.L")!);

  const worldQ = new Quaternion();
  const parentQ = new Quaternion();
  const chains = [NECK_CHAIN, ...SIDES.flatMap((side) => CHAINS(side))];
  {
    for (const chain of chains) {
      for (let i = 0; i < chain.bones.length - 1; i++) {
        const bone = rig.bone(chain.bones[i]);
        const current = pos(chain.bones[i + 1])
          .sub(pos(chain.bones[i]))
          .normalize();
        const desired = atlas
          .get(chain.landmarks[i + 1])!
          .clone()
          .sub(atlas.get(chain.landmarks[i])!)
          .normalize();
        const delta = new Quaternion().setFromUnitVectors(current, desired);
        bone.getWorldQuaternion(worldQ);
        (bone.parent as Object3DLike).getWorldQuaternion(parentQ);
        bone.quaternion.copy(parentQ.invert().multiply(delta.multiply(worldQ)));
        bone.updateMatrixWorld(true);
      }
    }
  }
  rig.scene.updateMatrixWorld(true);
  return { before, after: abduction(armDir()), atlasDeg: abduction(atlasL) };
}

type Object3DLike = { getWorldQuaternion: (target: Quaternion) => Quaternion };
