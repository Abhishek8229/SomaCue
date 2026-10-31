import { ATLAS_BASE_PATH } from "./lab-assets";
import type { Vec3 } from "./lab-types";

export const ATLAS_SYSTEMS = [
  "skeletal",
  "muscular",
  "connective",
  "nervous",
  "arterial",
  "venous",
  "lymphatic",
  "cardiac",
  "respiratory",
  "digestive",
  "urinary",
  "reproductive",
  "endocrine",
  "sensory",
  "integumentary",
] as const;

export type AtlasSystemId = (typeof ATLAS_SYSTEMS)[number];

export type AtlasPartMeta = {
  id: string;
  name: string;
  conceptId: string;
  system: AtlasSystemId;
  chunk: number;
  positions: number;
  normals: number;
  indices: number;
  vertexCount: number;
  indexCount: number;
  bounds: [number[], number[]];
};

type AtlasChunkMeta = { url: string; bytes: number; gzip?: string; gzipBytes?: number };

type AtlasManifest = {
  version: string;
  sex?: string;
  parts: AtlasPartMeta[];
  chunks: AtlasChunkMeta[];
  triangles: number;
};

export type AtlasPart = AtlasPartMeta & {
  /** float32 xyz, metres, Y-up, as packaged by Human Atlas */
  pos: Float32Array;
  /** int16 normalised xyz */
  nrm: Int16Array;
  idx: Uint32Array;
};

export type AtlasData = {
  version: string;
  parts: AtlasPart[];
  byName: Map<string, AtlasPart>;
  vertices: number;
  triangles: number;
};

function basename(url: string): string {
  return url.split("/").pop() ?? url;
}

async function fetchChunk(file: string, expectedBytes: number, signal?: AbortSignal) {
  const response = await fetch(`${ATLAS_BASE_PATH}${file}`, { signal });
  if (!response.ok) throw new Error(`Human Atlas file ${file} returned HTTP ${response.status}.`);
  const raw = await response.arrayBuffer();
  const head = new Uint8Array(raw, 0, 2);
  let buffer = raw;
  // Served as a plain .gz file; a server that already inflated it is tolerated.
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
    buffer = await new Response(stream).arrayBuffer();
  }
  if (buffer.byteLength !== expectedBytes) {
    throw new Error(
      `Human Atlas file ${file} decoded to ${buffer.byteLength} bytes; expected ${expectedBytes}.`,
    );
  }
  return buffer;
}

export async function loadAtlas(
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<AtlasData> {
  const manifestResponse = await fetch(`${ATLAS_BASE_PATH}atlas.json`, { signal });
  if (!manifestResponse.ok) {
    throw new Error(`Human Atlas manifest returned HTTP ${manifestResponse.status}.`);
  }
  const manifest = (await manifestResponse.json()) as AtlasManifest;

  const buffers: ArrayBuffer[] = new Array(manifest.chunks.length);
  let done = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < manifest.chunks.length) {
      const index = cursor++;
      const chunk = manifest.chunks[index];
      buffers[index] = await fetchChunk(
        basename(chunk.gzip ?? chunk.url),
        chunk.bytes,
        signal,
      );
      done += 1;
      onProgress(done / manifest.chunks.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  let vertices = 0;
  const parts: AtlasPart[] = manifest.parts.map((meta) => {
    const buffer = buffers[meta.chunk];
    vertices += meta.vertexCount;
    return {
      ...meta,
      pos: new Float32Array(buffer, meta.positions, meta.vertexCount * 3),
      nrm: new Int16Array(buffer, meta.normals, meta.vertexCount * 3),
      idx: new Uint32Array(buffer, meta.indices, meta.indexCount),
    };
  });

  return {
    version: manifest.version,
    parts,
    byName: new Map(parts.map((part) => [part.name.toLowerCase(), part])),
    vertices,
    triangles: parts.reduce((sum, part) => sum + part.indexCount / 3, 0),
  };
}

export function requirePart(atlas: AtlasData, name: string): AtlasPart {
  const part = atlas.byName.get(name.toLowerCase());
  if (!part) throw new Error(`Human Atlas has no structure named "${name}".`);
  return part;
}

export function partCentroid(part: AtlasPart): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = part.pos.length / 3;
  for (let i = 0; i < part.pos.length; i += 3) {
    x += part.pos[i];
    y += part.pos[i + 1];
    z += part.pos[i + 2];
  }
  return [x / n, y / n, z / n];
}

/**
 * Centroid of the vertices in the top or bottom fraction of a part's height.
 * Used as a cheap joint-end estimate for long bones.
 */
export function partEndCentroid(part: AtlasPart, end: "top" | "bottom", fraction: number): Vec3 {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < part.pos.length; i += 3) {
    min = Math.min(min, part.pos[i]);
    max = Math.max(max, part.pos[i]);
  }
  const span = max - min;
  const threshold = end === "top" ? max - span * fraction : min + span * fraction;
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (let i = 0; i < part.pos.length; i += 3) {
    const height = part.pos[i + 1];
    if (end === "top" ? height >= threshold : height <= threshold) {
      x += part.pos[i];
      y += height;
      z += part.pos[i + 2];
      n += 1;
    }
  }
  return [x / n, y / n, z / n];
}

export function partBounds(parts: AtlasPart[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], part.bounds[0][axis]);
      max[axis] = Math.max(max[axis], part.bounds[1][axis]);
    }
  }
  return { min, max };
}
