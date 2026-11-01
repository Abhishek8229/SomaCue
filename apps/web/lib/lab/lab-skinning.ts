import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import {
  ATLAS_SYSTEMS,
  partCentroid,
  type AtlasData,
  type AtlasSystemId,
} from "./atlas-loader";
import type { LabRig } from "./lab-rig";
import type { RegionId } from "./lab-types";

export type SkinSegment = {
  boneName: string;
  boneIndex: number;
  a: Vector3;
  b: Vector3;
  region: RegionId;
};

export const SYSTEM_STYLE: Record<
  AtlasSystemId,
  { label: string; color: string }
> = {
  skeletal: { label: "Skeleton", color: "#e4dcc0" },
  muscular: { label: "Muscles", color: "#b4584c" },
  connective: { label: "Connective tissue", color: "#a8c2b8" },
  nervous: { label: "Nervous system", color: "#dcb85e" },
  arterial: { label: "Arteries", color: "#c8483c" },
  venous: { label: "Veins", color: "#4f7ea6" },
  lymphatic: { label: "Lymphatic", color: "#86a37a" },
  cardiac: { label: "Heart", color: "#c46a62" },
  respiratory: { label: "Respiratory", color: "#c48e96" },
  digestive: { label: "Digestive", color: "#bd9368" },
  urinary: { label: "Urinary", color: "#b57c64" },
  reproductive: { label: "Reproductive", color: "#c4a49b" },
  endocrine: { label: "Endocrine", color: "#c9a29c" },
  sensory: { label: "Sensory organs", color: "#b2cad0" },
  integumentary: { label: "Atlas skin and hair", color: "#c9a888" },
};

/** Structures that stretch across joints are blended between two bones; the rest move rigidly. */
const SOFT: ReadonlySet<AtlasSystemId> = new Set([
  "muscular",
  "arterial",
  "venous",
  "nervous",
  "connective",
  "lymphatic",
  "integumentary",
]);
export const isSoftSystem = (system: AtlasSystemId) => SOFT.has(system);

/** Layers shown the first time the lab opens. */
export const DEFAULT_SYSTEMS: ReadonlySet<AtlasSystemId> = new Set([
  "skeletal",
  "muscular",
  "cardiac",
  "respiratory",
  "digestive",
  "urinary",
  "nervous",
  "arterial",
  "venous",
]);

const SIDES = ["L", "R"] as const;

/**
 * Segments used to decide which bone a vertex follows. They are built from the
 * rig's joint positions in the pose the atlas is bound in (the matched pose).
 */
export function buildSegments(rig: LabRig): SkinSegment[] {
  rig.scene.updateMatrixWorld(true);
  const index = new Map(rig.skeleton.bones.map((bone, i) => [bone, i]));
  const pos = (name: string) => rig.bone(name).getWorldPosition(new Vector3());
  const segments: SkinSegment[] = [];
  const add = (bone: string, a: Vector3, b: Vector3, region: RegionId) =>
    segments.push({
      boneName: bone,
      boneIndex: index.get(rig.bone(bone)) as number,
      a,
      b,
      region,
    });

  const hipMid = pos("upperleg01.L")
    .add(pos("upperleg01.R"))
    .multiplyScalar(0.5);
  add(
    "root",
    hipMid.clone().add(new Vector3(0, -0.09, 0)),
    hipMid.clone().add(new Vector3(0, 0.02, 0)),
    "torso",
  );
  add("spine05", pos("spine05"), pos("spine04"), "torso");
  add("spine04", pos("spine04"), pos("spine03"), "torso");
  add("spine03", pos("spine03"), pos("spine02"), "torso");
  add("spine02", pos("spine02"), pos("spine01"), "torso");
  add("spine01", pos("spine01"), pos("neck01"), "torso");
  add("neck01", pos("neck01"), pos("neck03"), "torso");
  add("head", pos("neck03"), pos("head").add(new Vector3(0, 0.12, 0)), "head");

  for (const side of SIDES) {
    const arm: RegionId = `arm.${side}`;
    const leg: RegionId = `leg.${side}`;
    add(
      `clavicle.${side}`,
      pos(`clavicle.${side}`),
      pos(`upperarm01.${side}`),
      arm,
    );
    add(
      `upperarm01.${side}`,
      pos(`upperarm01.${side}`),
      pos(`lowerarm01.${side}`),
      arm,
    );
    add(
      `lowerarm01.${side}`,
      pos(`lowerarm01.${side}`),
      pos(`wrist.${side}`),
      arm,
    );
    add(`wrist.${side}`, pos(`wrist.${side}`), pos(`finger3-3.${side}`), arm);
    add(
      `upperleg01.${side}`,
      pos(`upperleg01.${side}`),
      pos(`lowerleg01.${side}`),
      leg,
    );
    add(
      `lowerleg01.${side}`,
      pos(`lowerleg01.${side}`),
      pos(`foot.${side}`),
      leg,
    );
    add(`foot.${side}`, pos(`foot.${side}`), pos(`toe2-3.${side}`), leg);
  }
  return segments;
}

function segmentDistanceSq(p: Vector3, seg: SkinSegment): number {
  const abx = seg.b.x - seg.a.x;
  const aby = seg.b.y - seg.a.y;
  const abz = seg.b.z - seg.a.z;
  const apx = p.x - seg.a.x;
  const apy = p.y - seg.a.y;
  const apz = p.z - seg.a.z;
  const len2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = Math.max(
    0,
    Math.min(1, (apx * abx + apy * aby + apz * abz) / len2),
  );
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export type AtlasBuild = {
  meshes: Map<AtlasSystemId, SkinnedMesh>;
  skeleton: Skeleton;
  segments: SkinSegment[];
  regionOfBone: Map<number, RegionId>;
  stats: { vertices: number; softVertices: number; rigidParts: number };
  dispose: () => void;
};

/**
 * Transform the atlas into rig space (uniform scale + translation) and build
 * one skinned mesh per anatomical system, bound to the rig's bones. The skeleton
 * used has bone inverses taken from the CURRENT pose, so the rig must already
 * be in the pose the atlas should be bound in.
 */
export async function buildAtlasMeshes(
  atlas: AtlasData,
  fit: { scale: number; translation: Vector3 },
  rig: LabRig,
  segments: SkinSegment[],
  onProgress: (fraction: number) => void,
): Promise<AtlasBuild> {
  rig.scene.updateMatrixWorld(true);
  const bones = rig.skeleton.bones;
  const boneInverses = bones.map((bone) => bone.matrixWorld.clone().invert());
  const skeleton = new Skeleton(bones, boneInverses);

  const s = fit.scale;
  const t = fit.translation;
  const meshes = new Map<AtlasSystemId, SkinnedMesh>();
  const regionOfBone = new Map<number, RegionId>(
    segments.map((seg) => [seg.boneIndex, seg.region]),
  );
  let totalVertices = 0;
  let softVertices = 0;
  let rigidParts = 0;
  let processed = 0;
  let sinceYield = 0;
  const totalWork = atlas.vertices;
  const point = new Vector3();
  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];

  for (const system of ATLAS_SYSTEMS) {
    const parts = atlas.parts.filter((part) => part.system === system);
    if (parts.length === 0) continue;
    const vertexCount = parts.reduce((sum, part) => sum + part.vertexCount, 0);
    const indexCount = parts.reduce((sum, part) => sum + part.indexCount, 0);

    const position = new Float32Array(vertexCount * 3);
    const normal = new Int16Array(vertexCount * 3);
    const index = new Uint32Array(indexCount);
    const skinIndex = new Uint16Array(vertexCount * 4);
    const skinWeight = new Float32Array(vertexCount * 4);
    const soft = isSoftSystem(system);

    let vCursor = 0;
    let iCursor = 0;
    for (const part of parts) {
      const base = vCursor;
      for (let k = 0; k < part.vertexCount * 3; k += 3) {
        const o = base * 3 + k;
        position[o] = part.pos[k] * s + t.x;
        position[o + 1] = part.pos[k + 1] * s + t.y;
        position[o + 2] = part.pos[k + 2] * s + t.z;
      }
      normal.set(part.nrm, base * 3);
      for (let k = 0; k < part.indexCount; k++)
        index[iCursor + k] = part.idx[k] + base;
      iCursor += part.indexCount;

      if (!soft) {
        const c = partCentroid(part);
        point.set(c[0] * s + t.x, c[1] * s + t.y, c[2] * s + t.z);
        let best = 0;
        let bestD = Infinity;
        segments.forEach((seg, i) => {
          const d = segmentDistanceSq(point, seg);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        const bone = segments[best].boneIndex;
        for (let v = 0; v < part.vertexCount; v++) {
          skinIndex[(base + v) * 4] = bone;
          skinWeight[(base + v) * 4] = 1;
        }
        rigidParts += 1;
      } else {
        for (let v = 0; v < part.vertexCount; v++) {
          const o = (base + v) * 3;
          point.set(position[o], position[o + 1], position[o + 2]);
          let d1 = Infinity;
          let d2 = Infinity;
          let s1 = -1;
          let s2 = -1;
          for (let i = 0; i < segments.length; i++) {
            const d = segmentDistanceSq(point, segments[i]);
            if (d < d1) {
              d2 = d1;
              s2 = s1;
              d1 = d;
              s1 = i;
            } else if (d < d2) {
              d2 = d;
              s2 = i;
            }
          }
          // Inverse fourth power of distance: close to a bone it dominates, near a joint it blends.
          const w1 = 1 / (d1 * d1 + 1e-9);
          const w2 = s2 >= 0 ? 1 / (d2 * d2 + 1e-9) : 0;
          const sum = w1 + w2;
          const dst = (base + v) * 4;
          skinIndex[dst] = segments[s1].boneIndex;
          skinWeight[dst] = w1 / sum;
          if (s2 >= 0) {
            skinIndex[dst + 1] = segments[s2].boneIndex;
            skinWeight[dst + 1] = w2 / sum;
          }
        }
        softVertices += part.vertexCount;
      }
      vCursor += part.vertexCount;
      processed += part.vertexCount;
      sinceYield += part.vertexCount;
      if (soft && sinceYield > 60_000) {
        sinceYield = 0;
        onProgress(processed / totalWork);
        await tick();
      }
    }
    onProgress(processed / totalWork);
    await tick();

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setAttribute("normal", new BufferAttribute(normal, 3, true));
    geometry.setAttribute("skinIndex", new BufferAttribute(skinIndex, 4));
    geometry.setAttribute("skinWeight", new BufferAttribute(skinWeight, 4));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometries.push(geometry);

    const style = SYSTEM_STYLE[system];
    const isSkin = system === "integumentary";
    const material = new MeshStandardMaterial({
      color: style.color,
      roughness: 0.55,
      metalness: 0.06,
      side: DoubleSide,
      transparent: isSkin,
      opacity: isSkin ? 0.12 : 1,
      depthWrite: !isSkin,
    });
    materials.push(material);

    const mesh = new SkinnedMesh(geometry, material);
    mesh.name = `atlas-${system}`;
    mesh.frustumCulled = false;
    mesh.bind(skeleton, new Matrix4());
    mesh.visible = DEFAULT_SYSTEMS.has(system);
    meshes.set(system, mesh);
    totalVertices += vertexCount;
  }

  return {
    meshes,
    skeleton,
    segments,
    regionOfBone,
    stats: { vertices: totalVertices, softVertices, rigidParts },
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
