#!/usr/bin/env node
/**
 * Builds apps/web/public/assets/stage/soma-body.glb from the Quaternius
 * "Universal Base Characters [Standard]" zip (CC0).
 *
 * Usage:
 *   node scripts/build-soma-body.mjs [path-to-zip] [body-name]
 *
 * Defaults: the zip in apps/web/public/models/ and "Superhero_Male_FullBody".
 * The free Standard pack ships only the Superhero bodies. Every body in the
 * pack shares the same universal skeleton, so a Regular body from the Source
 * pack can be built later by passing its .gltf base name.
 *
 * What the script does (nothing else is changed):
 * - keeps the skinned body mesh and the full armature,
 * - keeps the eyes (iris painted into vertex colours) and eyebrows as their own
 *   skinned meshes; drops every texture and image,
 * - keeps only POSITION, NORMAL, JOINTS_0 and WEIGHTS_0,
 * - softens the bind-pose surface into a calmer studio mannequin (gentler muscle
 *   definition, slimmer deltoids, smaller hands; face kept; bones untouched),
 * - replaces the material with one plain material (the app overrides it),
 * - writes a single binary GLB.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ZIP_DIR = join(ROOT, "apps/web/public/models");
const OUTPUT = join(ROOT, "apps/web/public/assets/stage/soma-body.glb");

function findDefaultZip() {
  const zip = readdirSync(DEFAULT_ZIP_DIR).find((name) => name.toLowerCase().endsWith(".zip"));
  if (!zip) throw new Error(`No zip found in ${DEFAULT_ZIP_DIR}`);
  return join(DEFAULT_ZIP_DIR, zip);
}

/** Minimal zip reader: central directory, stored (0) and deflate (8) entries. */
function readZip(path) {
  const data = readFileSync(path);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file (no end of central directory).");
  const count = data.readUInt16LE(eocd + 10);
  let cursor = data.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Corrupt zip central directory.");
    const method = data.readUInt16LE(cursor + 10);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const name = data.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`Zip entry not found: ${name}`);
      const local = entry.localOffset;
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
      const raw = data.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return Buffer.from(raw);
      if (entry.method === 8) return inflateRawSync(raw);
      throw new Error(`Unsupported zip compression method ${entry.method} for ${name}`);
    },
  };
}

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const KEEP_ATTRIBUTES = ["POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0"];

/** Read any accessor into a Float64Array (normalized integers become 0 to 1). */
function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const size = TYPE_COMPONENTS[accessor.type];
  const bytes = COMPONENT_BYTES[accessor.componentType];
  const stride = view.byteStride ?? size * bytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float64Array(accessor.count * size);
  const readers = {
    5120: (o) => bin.readInt8(o),
    5121: (o) => bin.readUInt8(o),
    5122: (o) => bin.readInt16LE(o),
    5123: (o) => bin.readUInt16LE(o),
    5125: (o) => bin.readUInt32LE(o),
    5126: (o) => bin.readFloatLE(o),
  };
  const scale = accessor.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[accessor.componentType] ?? 1 : 1;
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < size; c++) out[i * size + c] = readers[accessor.componentType](start + i * stride + c * bytes) / scale;
  }
  return out;
}

/** Column-major 4x4 inverse (glTF matrices). */
function invert4(m) {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Vertex colours for the eye spheres (the pack's eye texture is not shipped, so
 * the GLB stays texture-free and loads headless). Each eye's iris and pupil are
 * painted around its forward (+Z) axis; colours are linear.
 */
function paintEyes(positions) {
  const count = positions.length / 3;
  const colors = new Float32Array(count * 3);
  const sclera = [0.78, 0.74, 0.69];
  const iris = [0.11, 0.06, 0.03];
  const pupil = [0.012, 0.009, 0.008];
  for (const side of [1, -1]) {
    const members = [];
    for (let v = 0; v < count; v++) if (Math.sign(positions[v * 3]) === side) members.push(v);
    if (members.length === 0) continue;
    const center = [0, 1, 2].map((c) => members.reduce((sum, v) => sum + positions[v * 3 + c], 0) / members.length);
    for (const v of members) {
      const d = [0, 1, 2].map((c) => positions[v * 3 + c] - center[c]);
      const length = Math.hypot(...d) || 1;
      const angle = Math.acos(Math.min(1, Math.max(-1, d[2] / length)));
      const irisMix = 1 - smoothstep(0.42, 0.52, angle);
      const pupilMix = 1 - smoothstep(0.16, 0.22, angle);
      for (let c = 0; c < 3; c++) {
        const base = sclera[c] + (iris[c] - sclera[c]) * irisMix;
        colors[v * 3 + c] = base + (pupil[c] - base) * pupilMix;
      }
    }
  }
  return colors;
}

/**
 * Turns the stylised superhero into a quieter clinical mannequin by editing
 * the bind-pose surface only. Bones, skin weights and joint positions are
 * untouched, so every joint and every movement stays exactly where it was.
 * - torso and limbs are lightly smoothed (Taubin, volume preserving) to soften the
 *   superhero muscle lines; the face, hands and feet are left as modelled;
 * - the upper arms are slimmed toward the bone axis, most at the deltoid;
 * - the hands are scaled down slightly about the wrist.
 * Normals are recomputed with seams welded so shading stays smooth.
 */
function sculptMannequin({ positions, joints, weights, indices, inverseBind, jointNames }) {
  const vertexCount = positions.length / 3;
  const p = Float64Array.from(positions);
  const jointPos = jointNames.map((_, j) => {
    const world = invert4(inverseBind.subarray(j * 16, j * 16 + 16));
    return [world[12], world[13], world[14]];
  });
  const jointIndex = (name) => {
    const i = jointNames.indexOf(name);
    if (i < 0) throw new Error(`The rig has no joint "${name}".`);
    return i;
  };
  const descendantsOf = (root) => {
    // Joint names are hierarchical by prefix in this rig (hand_l owns *_l fingers).
    const side = root.slice(-2);
    return new Set(
      jointNames
        .map((name, i) => ({ name, i }))
        .filter(({ name }) => name === root || (/^(thumb|index|middle|ring|pinky)_/.test(name) && name.endsWith(side)))
        .map(({ i }) => i),
    );
  };
  const weightOf = (v, set) => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (set.has(joints[v * 4 + k])) w += weights[v * 4 + k];
    return w;
  };

  // Weld split vertices so smoothing and normals do not open seams.
  const key = (v) => `${Math.round(p[v * 3] * 1e5)},${Math.round(p[v * 3 + 1] * 1e5)},${Math.round(p[v * 3 + 2] * 1e5)}`;
  const groupOf = new Int32Array(vertexCount);
  const groups = [];
  const byKey = new Map();
  for (let v = 0; v < vertexCount; v++) {
    const k = key(v);
    let g = byKey.get(k);
    if (g === undefined) {
      g = groups.length;
      byKey.set(k, g);
      groups.push([]);
    }
    groups[g].push(v);
    groupOf[v] = g;
  }
  const groupCount = groups.length;
  const gp = new Float64Array(groupCount * 3);
  for (let g = 0; g < groupCount; g++) for (let c = 0; c < 3; c++) gp[g * 3 + c] = p[groups[g][0] * 3 + c];
  const neighbours = Array.from({ length: groupCount }, () => new Set());
  for (let t = 0; t < indices.length; t += 3) {
    const a = groupOf[indices[t]];
    const b = groupOf[indices[t + 1]];
    const c = groupOf[indices[t + 2]];
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }

  // 1. Softer muscle definition. Taubin smoothing (volume preserving) on the
  //    torso and limbs only. The face, hands and feet keep their detail, so the
  //    figure still reads as a human with a real face.
  const keepDetail = new Set([
    jointIndex("Head"),
    ...descendantsOf("hand_l"),
    ...descendantsOf("hand_r"),
    jointIndex("foot_l"),
    jointIndex("foot_r"),
    jointIndex("ball_l"),
    jointIndex("ball_r"),
  ]);
  const smoothAmount = new Float64Array(groupCount);
  for (let g = 0; g < groupCount; g++) {
    smoothAmount[g] = 1 - smoothstep(0.05, 0.5, weightOf(groups[g][0], keepDetail));
  }
  const relax = (factor) => {
    const next = Float64Array.from(gp);
    for (let g = 0; g < groupCount; g++) {
      if (smoothAmount[g] <= 0 || neighbours[g].size === 0) continue;
      let x = 0;
      let y = 0;
      let z = 0;
      for (const n of neighbours[g]) {
        x += gp[n * 3];
        y += gp[n * 3 + 1];
        z += gp[n * 3 + 2];
      }
      const inv = 1 / neighbours[g].size;
      const f = factor * smoothAmount[g];
      next[g * 3] += (x * inv - gp[g * 3]) * f;
      next[g * 3 + 1] += (y * inv - gp[g * 3 + 1]) * f;
      next[g * 3 + 2] += (z * inv - gp[g * 3 + 2]) * f;
    }
    gp.set(next);
  };
  for (let i = 0; i < 6; i++) {
    relax(0.5);
    relax(-0.53);
  }
  // 2. Slimmer deltoids and upper arms, 3. smaller hands.
  for (const side of ["l", "r"]) {
    const upper = new Set([jointIndex(`upperarm_${side}`)]);
    const a = jointPos[jointIndex(`upperarm_${side}`)];
    const b = jointPos[jointIndex(`lowerarm_${side}`)];
    const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const length = Math.hypot(...axis);
    axis.forEach((_, i) => (axis[i] /= length));
    const hands = descendantsOf(`hand_${side}`);
    const wrist = jointPos[jointIndex(`hand_${side}`)];
    for (let g = 0; g < groupCount; g++) {
      const v = groups[g][0];
      const wu = weightOf(v, upper);
      if (wu > 0) {
        const d = [gp[g * 3] - a[0], gp[g * 3 + 1] - a[1], gp[g * 3 + 2] - a[2]];
        const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
        const t = Math.min(1, Math.max(0, along / length));
        const shrink = (0.13 - 0.09 * t) * wu;
        for (let c = 0; c < 3; c++) {
          const onAxis = a[c] + axis[c] * along;
          gp[g * 3 + c] = onAxis + (gp[g * 3 + c] - onAxis) * (1 - shrink);
        }
      }
      const wh = weightOf(v, hands);
      if (wh > 0) {
        const k = 1 - 0.1 * wh;
        for (let c = 0; c < 3; c++) gp[g * 3 + c] = wrist[c] + (gp[g * 3 + c] - wrist[c]) * k;
      }
    }
  }

  const out = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) for (let c = 0; c < 3; c++) out[v * 3 + c] = gp[groupOf[v] * 3 + c];

  // Area-weighted normals per welded position.
  const gn = new Float64Array(groupCount * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const [i0, i1, i2] = [indices[t], indices[t + 1], indices[t + 2]].map((i) => groupOf[i]);
    const e1 = [0, 1, 2].map((c) => gp[i1 * 3 + c] - gp[i0 * 3 + c]);
    const e2 = [0, 1, 2].map((c) => gp[i2 * 3 + c] - gp[i0 * 3 + c]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const g of [i0, i1, i2]) for (let c = 0; c < 3; c++) gn[g * 3 + c] += n[c];
  }
  const normals = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const g = groupOf[v];
    const len = Math.hypot(gn[g * 3], gn[g * 3 + 1], gn[g * 3 + 2]) || 1;
    for (let c = 0; c < 3; c++) normals[v * 3 + c] = gn[g * 3 + c] / len;
  }

  let moved = 0;
  for (let i = 0; i < out.length; i++) moved = Math.max(moved, Math.abs(out[i] - positions[i]));
  console.log(`Sculpt: ${vertexCount} vertices, ${groupCount} welded, largest move ${(moved * 1000).toFixed(1)} mm.`);
  return { positions: out, normals };
}

function build(zipPath, bodyName) {
  const zip = readZip(zipPath);
  const gltfName = zip.names.find((name) => name.endsWith(`/${bodyName}.gltf`) && name.includes("Godot - UE"));
  if (!gltfName) throw new Error(`No ${bodyName}.gltf in the Godot - UE folder of the zip.`);
  const gltf = JSON.parse(zip.read(gltfName).toString("utf8"));
  if (gltf.buffers.length !== 1) throw new Error("Expected exactly one buffer.");
  const bin = zip.read(join(dirname(gltfName), gltf.buffers[0].uri).replaceAll("\\", "/"));

  const skinnedMeshNodes = gltf.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.mesh !== undefined && node.skin !== undefined);
  const triangles = ({ node }) =>
    gltf.meshes[node.mesh].primitives.reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);
  const body = skinnedMeshNodes.reduce((best, item) => (triangles(item) > triangles(best) ? item : best));
  // The eyes and eyebrows are kept as their own skinned meshes on the same skin.
  const isFeature = (node) => /^(Eyes|Eyebrows)$/.test(node.name ?? "");
  const features = skinnedMeshNodes.filter(({ node, index }) => index !== body.index && isFeature(node));
  const kept = new Set([body.index, ...features.map(({ index }) => index)]);
  const dropped = new Set(
    gltf.nodes.map((node, index) => (node.mesh !== undefined && !kept.has(index) ? index : -1)).filter((i) => i >= 0),
  );

  const remap = new Map();
  const nodes = [];
  gltf.nodes.forEach((node, index) => {
    if (dropped.has(index)) return;
    remap.set(index, nodes.length);
    nodes.push({ ...node });
  });
  for (const node of nodes) {
    if (node.children) node.children = node.children.filter((c) => !dropped.has(c)).map((c) => remap.get(c));
    if (node.children?.length === 0) delete node.children;
  }

  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  const copyAccessor = (index, target) => {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const elementBytes = COMPONENT_BYTES[accessor.componentType] * TYPE_COMPONENTS[accessor.type];
    const stride = view.byteStride ?? elementBytes;
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const out = Buffer.alloc(elementBytes * accessor.count);
    for (let i = 0; i < accessor.count; i++) {
      bin.copy(out, i * elementBytes, start + i * stride, start + i * stride + elementBytes);
    }
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: out.length, ...(target ? { target } : {}) });
    chunks.push(out);
    offset += out.length;
    const copy = { ...accessor, bufferView: bufferViews.length - 1 };
    delete copy.byteOffset;
    delete copy.sparse;
    accessors.push(copy);
    return accessors.length - 1;
  };

  const sourceMesh = gltf.meshes[body.node.mesh];
  if (sourceMesh.primitives.length !== 1) throw new Error("Expected one body primitive.");
  const skin = gltf.skins[body.node.skin];
  const jointNames = skin.joints.map((j) => gltf.nodes[j].name);
  const read = (index) => readAccessor(gltf, bin, index);
  const primitives = sourceMesh.primitives.map((primitive) => {
    for (const name of KEEP_ATTRIBUTES) {
      if (primitive.attributes[name] === undefined) throw new Error(`Body mesh is missing ${name}.`);
    }
    const sculpted = sculptMannequin({
      positions: read(primitive.attributes.POSITION),
      joints: read(primitive.attributes.JOINTS_0),
      weights: read(primitive.attributes.WEIGHTS_0),
      indices: read(primitive.indices),
      inverseBind: read(skin.inverseBindMatrices),
      jointNames,
    });
    const attributes = {
      POSITION: addFloatAccessor(sculpted.positions, "VEC3", 34962, true),
      NORMAL: addFloatAccessor(sculpted.normals, "VEC3", 34962, false),
      JOINTS_0: copyAccessor(primitive.attributes.JOINTS_0, 34962),
      WEIGHTS_0: copyAccessor(primitive.attributes.WEIGHTS_0, 34962),
    };
    return { attributes, indices: copyAccessor(primitive.indices, 34963), material: 0, mode: primitive.mode ?? 4 };
  });

  function addFloatAccessor(array, type, target, withBounds) {
    const out = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      offset += padding;
    }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: out.length, target });
    chunks.push(Buffer.from(out));
    offset += out.length;
    const size = TYPE_COMPONENTS[type];
    const accessor = { bufferView: bufferViews.length - 1, componentType: 5126, count: array.length / size, type };
    if (withBounds) {
      const min = Array(size).fill(Infinity);
      const max = Array(size).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        min[i % size] = Math.min(min[i % size], array[i]);
        max[i % size] = Math.max(max[i % size], array[i]);
      }
      Object.assign(accessor, { min, max });
    }
    accessors.push(accessor);
    return accessors.length - 1;
  }

  const skins = [
    {
      name: skin.name ?? "Armature",
      joints: skin.joints.map((j) => remap.get(j)),
      inverseBindMatrices: copyAccessor(skin.inverseBindMatrices),
      ...(skin.skeleton !== undefined ? { skeleton: remap.get(skin.skeleton) } : {}),
    },
  ];

  const bodyNode = nodes[remap.get(body.index)];
  bodyNode.name = "SomaBody";
  bodyNode.mesh = 0;
  bodyNode.skin = 0;

  const meshes = [{ name: "SomaBody", primitives }];
  const materials = [
    {
      name: "SomaBodyMaterial",
      pbrMetallicRoughness: { baseColorFactor: [0.62, 0.7, 0.66, 1], metallicFactor: 0, roughnessFactor: 0.62 },
    },
  ];
  for (const feature of features) {
    const name = feature.node.name;
    const source = gltf.meshes[feature.node.mesh];
    const featurePrimitives = source.primitives.map((primitive) => {
      const attributes = {};
      for (const attribute of KEEP_ATTRIBUTES) attributes[attribute] = copyAccessor(primitive.attributes[attribute], 34962);
      if (name === "Eyes") {
        attributes.COLOR_0 = addFloatAccessor(paintEyes(read(primitive.attributes.POSITION)), "VEC3", 34962, false);
      }
      return { attributes, indices: copyAccessor(primitive.indices, 34963), material: materials.length, mode: primitive.mode ?? 4 };
    });
    materials.push(
      name === "Eyes"
        ? { name: "SomaEyes", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.35 } }
        : {
            name: "SomaBrows",
            pbrMetallicRoughness: { baseColorFactor: [0.11, 0.075, 0.05, 1], metallicFactor: 0, roughnessFactor: 0.9 },
          },
    );
    const node = nodes[remap.get(feature.index)];
    node.name = name === "Eyes" ? "SomaEyes" : "SomaBrows";
    node.mesh = meshes.length;
    node.skin = 0;
    meshes.push({ name: node.name, primitives: featurePrimitives });
  }

  const out = {
    asset: {
      version: "2.0",
      generator: "SomaCue build-soma-body.mjs",
      copyright: "Quaternius, CC0 1.0 (Universal Base Characters). Modified by SomaCue.",
    },
    scene: 0,
    scenes: gltf.scenes.map((scene) => ({ ...scene, nodes: scene.nodes.filter((n) => !dropped.has(n)).map((n) => remap.get(n)) })),
    nodes,
    meshes,
    materials,
    skins,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  const json = Buffer.from(JSON.stringify(out), "utf8");
  const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const binData = Buffer.concat(chunks);
  const binPadded = Buffer.concat([binData, Buffer.alloc((4 - (binData.length % 4)) % 4)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPadded.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPadded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]));

  const tris = primitives.reduce((sum, p) => sum + accessors[p.indices].count / 3, 0);
  const vertices = accessors[primitives[0].attributes.POSITION].count;
  console.log(
    JSON.stringify(
      {
        source: gltfName,
        output: OUTPUT.replace(ROOT, "").replaceAll("\\", "/"),
        bytes: total,
        triangles: tris,
        vertices,
        joints: skins[0].joints.length,
        droppedMeshNodes: [...dropped].map((i) => gltf.nodes[i].name),
      },
      null,
      2,
    ),
  );
}

build(process.argv[2] ? resolve(process.argv[2]) : findDefaultZip(), process.argv[3] ?? "Superhero_Male_FullBody");
