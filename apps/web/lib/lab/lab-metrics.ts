import type { Skeleton, SkinnedMesh } from "three";
import type { AtlasSystemId } from "./atlas-loader";
import type { LabRig } from "./lab-rig";
import { isSoftSystem, type AtlasBuild } from "./lab-skinning";
import type { PoseSample, RegionContainment, RegionId } from "./lab-types";

type NumArray = ArrayLike<number>;

function matricesOf(skeleton: Skeleton): Float32Array {
  skeleton.update();
  if (!skeleton.boneMatrices)
    throw new Error("The skeleton has no bone matrices.");
  return skeleton.boneMatrices;
}

/** Linear blend skinning of one vertex using a skeleton's boneMatrices. */
function skinVertex(
  out: Float32Array,
  outOffset: number,
  position: NumArray,
  vertex: number,
  skinIndex: NumArray,
  skinWeight: NumArray,
  boneMatrices: Float32Array,
) {
  const x = position[vertex * 3];
  const y = position[vertex * 3 + 1];
  const z = position[vertex * 3 + 2];
  let ox = 0;
  let oy = 0;
  let oz = 0;
  for (let k = 0; k < 4; k++) {
    const w = skinWeight[vertex * 4 + k];
    if (w === 0) continue;
    const m = skinIndex[vertex * 4 + k] * 16;
    ox +=
      w *
      (boneMatrices[m] * x +
        boneMatrices[m + 4] * y +
        boneMatrices[m + 8] * z +
        boneMatrices[m + 12]);
    oy +=
      w *
      (boneMatrices[m + 1] * x +
        boneMatrices[m + 5] * y +
        boneMatrices[m + 9] * z +
        boneMatrices[m + 13]);
    oz +=
      w *
      (boneMatrices[m + 2] * x +
        boneMatrices[m + 6] * y +
        boneMatrices[m + 10] * z +
        boneMatrices[m + 14]);
  }
  out[outOffset] = ox;
  out[outOffset + 1] = oy;
  out[outOffset + 2] = oz;
}

/** Ray-parity inside test against a triangle mesh, rays cast along +Z and -Z, with an XY grid. */
class SkinGrid {
  private cells: number[][] = [];
  private readonly minX: number;
  private readonly minY: number;
  private readonly nx: number;
  private readonly ny: number;

  constructor(
    private readonly p: Float32Array,
    private readonly tri: NumArray,
    private readonly cell = 0.02,
  ) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]);
      maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]);
      maxY = Math.max(maxY, p[i + 1]);
    }
    this.minX = minX;
    this.minY = minY;
    this.nx = Math.ceil((maxX - minX) / cell) + 1;
    this.ny = Math.ceil((maxY - minY) / cell) + 1;
    this.cells = Array.from({ length: this.nx * this.ny }, () => []);
    for (let t = 0; t < tri.length; t += 3) {
      const a = tri[t] * 3;
      const b = tri[t + 1] * 3;
      const c = tri[t + 2] * 3;
      const x0 = Math.min(p[a], p[b], p[c]);
      const x1 = Math.max(p[a], p[b], p[c]);
      const y0 = Math.min(p[a + 1], p[b + 1], p[c + 1]);
      const y1 = Math.max(p[a + 1], p[b + 1], p[c + 1]);
      const i0 = Math.floor((x0 - minX) / cell);
      const i1 = Math.floor((x1 - minX) / cell);
      const j0 = Math.floor((y0 - minY) / cell);
      const j1 = Math.floor((y1 - minY) / cell);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) this.cells[j * this.nx + i].push(t);
    }
  }

  inside(px: number, py: number, pz: number): boolean {
    const x = px + 1.234e-6;
    const y = py + 2.345e-6;
    const i = Math.floor((x - this.minX) / this.cell);
    const j = Math.floor((y - this.minY) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false;
    const list = this.cells[j * this.nx + i];
    const p = this.p;
    let above = 0;
    let below = 0;
    for (const t of list) {
      const a = this.tri[t] * 3;
      const b = this.tri[t + 1] * 3;
      const c = this.tri[t + 2] * 3;
      const ax = p[a];
      const ay = p[a + 1];
      const bx = p[b];
      const by = p[b + 1];
      const cx = p[c];
      const cy = p[c + 1];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1 * p[a + 2] + l2 * p[b + 2] + l3 * p[c + 2];
      if (z > pz) above += 1;
      else below += 1;
    }
    // A hole in the mesh (mouth, eye socket, glove-like hands) spoils the parity of
    // one ray only, so a point counts as inside if either direction says so.
    return (above & 1) === 1 || (below & 1) === 1;
  }
}

type Sample = { system: AtlasSystemId; vertex: number; region: RegionId };
type EdgeSample = {
  system: AtlasSystemId;
  a: number;
  b: number;
  restLen: number;
};

const REGIONS: RegionId[] = [
  "torso",
  "head",
  "arm.L",
  "arm.R",
  "leg.L",
  "leg.R",
];

/**
 * Measures how well the atlas sits inside, and keeps up with, the rig body.
 * Sample sets are fixed at construction so every pose is judged on the same vertices.
 */
export class PoseAnalyzer {
  private readonly skeletal: Sample[] = [];
  private readonly soft: Sample[] = [];
  private readonly edges: EdgeSample[] = [];
  private readonly bodyIndex: NumArray;
  private readonly bodyBase: NumArray;
  private readonly bodySkinIndex: NumArray;
  private readonly bodySkinWeight: NumArray;

  constructor(
    private readonly rig: LabRig,
    private readonly build: AtlasBuild,
    skeletalSamples = 3000,
    softSamples = 3000,
    edgeSamples = 6000,
  ) {
    const body: SkinnedMesh = rig.body;
    const geo = body.geometry;
    this.bodyBase = geo.attributes.position.array;
    this.bodySkinIndex = geo.attributes.skinIndex.array;
    this.bodySkinWeight = geo.attributes.skinWeight.array;
    if (!geo.index) throw new Error("The rig body has no index buffer.");
    this.bodyIndex = geo.index.array;

    const regionOf = (system: AtlasSystemId, vertex: number): RegionId => {
      const mesh = build.meshes.get(system) as SkinnedMesh;
      const si = mesh.geometry.attributes.skinIndex.array;
      const sw = mesh.geometry.attributes.skinWeight.array;
      let best = 0;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        if (sw[vertex * 4 + k] > bestW) {
          bestW = sw[vertex * 4 + k];
          best = si[vertex * 4 + k];
        }
      }
      return build.regionOfBone.get(best) ?? "torso";
    };

    const pick = (system: AtlasSystemId, count: number, into: Sample[]) => {
      if (count <= 0) return;
      const mesh = build.meshes.get(system);
      if (!mesh) return;
      const total = mesh.geometry.attributes.position.count;
      const stride = Math.max(1, Math.floor(total / count));
      for (let v = 0; v < total; v += stride)
        into.push({ system, vertex: v, region: regionOf(system, v) });
    };
    pick("skeletal", skeletalSamples, this.skeletal);
    const softSystems = [...build.meshes.keys()].filter(
      (s) => isSoftSystem(s) && s !== "integumentary",
    );
    const perSystem = Math.ceil(softSamples / Math.max(1, softSystems.length));
    for (const system of softSystems) pick(system, perSystem, this.soft);

    const perEdge = Math.ceil(edgeSamples / Math.max(1, softSystems.length));
    if (perEdge > 0) {
      for (const system of softSystems) {
        const mesh = build.meshes.get(system) as SkinnedMesh;
        const idx = mesh.geometry.index?.array as NumArray;
        const pos = mesh.geometry.attributes.position.array;
        const triCount = idx.length / 3;
        const stride = Math.max(1, Math.floor(triCount / perEdge));
        for (let t = 0; t < triCount; t += stride) {
          const a = idx[t * 3];
          const b = idx[t * 3 + 1];
          const dx = pos[a * 3] - pos[b * 3];
          const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
          const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
          const restLen = Math.hypot(dx, dy, dz);
          if (restLen > 0.002) this.edges.push({ system, a, b, restLen });
        }
      }
    }
  }

  private posedBody(): Float32Array {
    const count = this.bodyBase.length / 3;
    const out = new Float32Array(count * 3);
    const matrices = matricesOf(this.rig.skeleton);
    for (let v = 0; v < count; v++) {
      skinVertex(
        out,
        v * 3,
        this.bodyBase,
        v,
        this.bodySkinIndex,
        this.bodySkinWeight,
        matrices,
      );
    }
    return out;
  }

  /** Rig height in metres in the current pose (skin top minus skin bottom). */
  rigHeight(): number {
    this.rig.scene.updateMatrixWorld(true);
    this.rig.skeleton.update();
    const posed = this.posedBody();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 1; i < posed.length; i += 3) {
      min = Math.min(min, posed[i]);
      max = Math.max(max, posed[i]);
    }
    return max - min;
  }

  /**
   * Checks the inside/outside test against the rig's own surface: points nudged
   * inward along the vertex normal should read inside, points nudged outward
   * should read outside. Valid only while the rig is in its native pose, where
   * the stored normals still point the right way.
   */
  selfTest(offsetM = 0.005): {
    samples: number;
    inwardInsidePct: number;
    outwardInsidePct: number;
  } {
    this.rig.scene.updateMatrixWorld(true);
    this.rig.skeleton.update();
    const posed = this.posedBody();
    const grid = new SkinGrid(posed, this.bodyIndex);
    const normals = this.rig.body.geometry.attributes.normal.array;
    const count = posed.length / 3;
    const stride = Math.max(1, Math.floor(count / 3000));
    let n = 0;
    let inward = 0;
    let outward = 0;
    for (let v = 0; v < count; v += stride) {
      const o = v * 3;
      n += 1;
      if (
        grid.inside(
          posed[o] - normals[o] * offsetM,
          posed[o + 1] - normals[o + 1] * offsetM,
          posed[o + 2] - normals[o + 2] * offsetM,
        )
      )
        inward += 1;
      if (
        grid.inside(
          posed[o] + normals[o] * offsetM,
          posed[o + 1] + normals[o + 1] * offsetM,
          posed[o + 2] + normals[o + 2] * offsetM,
        )
      )
        outward += 1;
    }
    return {
      samples: n,
      inwardInsidePct: (100 * inward) / n,
      outwardInsidePct: (100 * outward) / n,
    };
  }

  /** Call after the rig pose has been applied and matrices updated. */
  analyze(label: string, timeS: number): PoseSample {
    this.rig.scene.updateMatrixWorld(true);
    this.rig.skeleton.update();
    this.build.skeleton.update();

    const posed = this.posedBody();
    const grid = new SkinGrid(posed, this.bodyIndex);
    let lowest = Infinity;
    for (let i = 1; i < posed.length; i += 3)
      lowest = Math.min(lowest, posed[i]);

    const matrices = matricesOf(this.build.skeleton);
    const tmp = new Float32Array(6);
    const run = (samples: Sample[]) => {
      const byRegion = new Map<RegionId, { n: number; inside: number }>();
      let inside = 0;
      for (const s of samples) {
        const mesh = this.build.meshes.get(s.system) as SkinnedMesh;
        const g = mesh.geometry.attributes;
        skinVertex(
          tmp,
          0,
          g.position.array,
          s.vertex,
          g.skinIndex.array,
          g.skinWeight.array,
          matrices,
        );
        const hit = grid.inside(tmp[0], tmp[1], tmp[2]);
        if (hit) inside += 1;
        const slot = byRegion.get(s.region) ?? { n: 0, inside: 0 };
        slot.n += 1;
        if (hit) slot.inside += 1;
        byRegion.set(s.region, slot);
      }
      return {
        pct: samples.length ? (100 * inside) / samples.length : 0,
        byRegion,
      };
    };
    const skeletal = run(this.skeletal);
    const soft = run(this.soft);

    const regions: RegionContainment[] = REGIONS.map((region) => {
      const slot = skeletal.byRegion.get(region);
      return {
        region,
        samples: slot?.n ?? 0,
        insidePct: slot && slot.n ? (100 * slot.inside) / slot.n : 0,
      };
    });

    let stretched = 0;
    let maxStretch = 1;
    for (const edge of this.edges) {
      const mesh = this.build.meshes.get(edge.system) as SkinnedMesh;
      const g = mesh.geometry.attributes;
      skinVertex(
        tmp,
        0,
        g.position.array,
        edge.a,
        g.skinIndex.array,
        g.skinWeight.array,
        matrices,
      );
      skinVertex(
        tmp,
        3,
        g.position.array,
        edge.b,
        g.skinIndex.array,
        g.skinWeight.array,
        matrices,
      );
      const len = Math.hypot(tmp[0] - tmp[3], tmp[1] - tmp[4], tmp[2] - tmp[5]);
      const ratio = len / edge.restLen;
      if (Math.abs(ratio - 1) > 0.25) stretched += 1;
      maxStretch = Math.max(maxStretch, ratio, 1 / Math.max(ratio, 1e-6));
    }

    return {
      label,
      timeS,
      skeletalInsidePct: skeletal.pct,
      ...(this.soft.length ? { softInsidePct: soft.pct } : {}),
      regions,
      ...(this.edges.length
        ? {
            softEdgesOver25Pct: (100 * stretched) / this.edges.length,
            maxEdgeStretch: maxStretch,
          }
        : {}),
      lowestSkinYmm: lowest * 1000,
    };
  }
}
