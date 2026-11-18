#!/usr/bin/env node
/**
 * Builds the SomaCue athlete body from a Character Creator 4 FBX export (Unity pack layout).
 *
 *   node scripts/athlete-male/build.cjs <unity export dir> [out dir]
 *
 * Input  <dir>/unity.Fbx, <dir>/unity.fbm/*.bmp (diffuse + normal),
 *        <dir>/textures/unity/... (Unity HDRP packs, used for AO and smoothness).
 * Output <out>/athlete-male.glb       full body, WebP textures, Meshopt-compressed
 *        <out>/athlete-male-lite.glb  same skeleton and geometry, no textures (tests, server, fallback)
 *        (out defaults to apps/web/public/models)
 *
 * What it does, and why:
 * - FBXLoader (headless Chrome, see extract.cjs) reads the FBX; the glTF is written here directly
 *   with @gltf-transform/core, because GLTFExporter cannot merge CC4's duplicated bones, keep
 *   unweighted structural bones, or bake Z-up centimetres into Y-up metres.
 * - Bones: CC4 exports every bone twice (structural + identity leaf, same name). They are merged.
 *   Bones that carry no weight and have no weighted descendant are dropped (tongue, teeth, ...).
 * - Scale and grounding: standing height 1.80 m, soles on y = 0, body faces +Z, the figure's
 *   left is +X. The armature root rotation (-90 degrees about X in the FBX) is baked out.
 * - Meshes: head, body, arm and leg skin are merged into ONE primitive with a 2x2 atlas (four
 *   1024 px regions), so the stage can swap one material and sample contacts from one mesh.
 *   Boxers and eyes are separate skinned meshes on the same skeleton. Nails, eyelashes, teeth,
 *   tongue, tear lines and eye occlusion are left out (not visible at stage scale).
 * - Textures: base colour and normal at 1024 px per region, WebP. AO, roughness (1 - HDRP
 *   smoothness) and metallic are packed into one ORM map at 512 px per region.
 * - Compression: `gltf-transform meshopt` (Meshopt, not Draco: it also decodes in plain Node,
 *   which the headless tests need).
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const sharp = require("sharp");
const { mat4, quat, vec3 } = require("gl-matrix");
const { Document, NodeIO } = require("@gltf-transform/core");
const { EXTTextureWebP } = require("@gltf-transform/extensions");
const { extract } = require("./extract.cjs");

const ROOT = path.resolve(__dirname, "../..");
const STANDING_HEIGHT_M = 1.8;
const TILE = 1024; // base colour and normal, per skin region
const ORM_TILE = 512; // AO / roughness / metallic, per skin region
const REGIONS = ["Std_Skin_Head", "Std_Skin_Body", "Std_Skin_Arm", "Std_Skin_Leg"];
// Each region's UVs sit in its own U tile (head 0..1, body 1..2, arm 2..3, leg 3..4).
const REGION_TILE_OFFSET = { Std_Skin_Head: 0, Std_Skin_Body: 1, Std_Skin_Arm: 2, Std_Skin_Leg: 3 };
// Bones the rig mapping needs even if they carry no weight (lib/kinematics/rig.ts).
const REQUIRED_BONES = [
  "CC_Base_Hip", "CC_Base_Pelvis", "CC_Base_Waist", "CC_Base_Spine01", "CC_Base_Spine02",
  "CC_Base_NeckTwist01", "CC_Base_NeckTwist02", "CC_Base_Head",
  ...["L", "R"].flatMap((s) => [
    `CC_Base_${s}_Clavicle`, `CC_Base_${s}_Upperarm`, `CC_Base_${s}_Forearm`, `CC_Base_${s}_Hand`,
    `CC_Base_${s}_Index1`, `CC_Base_${s}_Mid1`, `CC_Base_${s}_Pinky1`,
    `CC_Base_${s}_Thigh`, `CC_Base_${s}_Calf`, `CC_Base_${s}_Foot`, `CC_Base_${s}_ToeBase`, `CC_Base_${s}_MidToe1`,
  ]),
];

const log = (...args) => console.log(...args);

/* ---------- small readers ---------- */

function bmp(file) {
  const b = fs.readFileSync(file);
  const offset = b.readUInt32LE(10);
  const width = b.readInt32LE(18);
  const heightRaw = b.readInt32LE(22);
  const bpp = b.readUInt16LE(28);
  if (b.readUInt32LE(30) !== 0 || (bpp !== 24 && bpp !== 32)) throw new Error(`Unsupported BMP: ${file}`);
  const height = Math.abs(heightRaw);
  const bytes = bpp / 8;
  const row = Math.floor((bpp * width + 31) / 32) * 4;
  const channels = bytes;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const sy = heightRaw > 0 ? height - 1 - y : y; // bottom-up files are flipped to top-down
    for (let x = 0; x < width; x++) {
      const p = offset + sy * row + x * bytes;
      const o = (y * width + x) * channels;
      data[o] = b[p + 2];
      data[o + 1] = b[p + 1];
      data[o + 2] = b[p];
      if (channels === 4) data[o + 3] = b[p + 3];
    }
  }
  return { width, height, channels, data };
}

const decode = (b64, Type) => {
  const buffer = Buffer.from(b64, "base64");
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Type(copy);
};

/* ---------- textures ---------- */

async function rgbTile(image, size, { flipGreen = false } = {}) {
  const input = { raw: { width: image.width, height: image.height, channels: image.channels } };
  let pipeline = sharp(image.data, input);
  if (image.channels === 4) pipeline = pipeline.removeAlpha();
  const resized = await pipeline.resize(size, size, { kernel: "lanczos3" }).raw().toBuffer();
  // CC4 normal maps use the DirectX convention (green points down). glTF wants OpenGL (green up).
  if (flipGreen) for (let i = 1; i < resized.length; i += 3) resized[i] = 255 - resized[i];
  return resized;
}

async function atlas(tiles, tileSize, encode) {
  const size = tileSize * 2;
  const composite = tiles.map((buffer, i) => ({
    input: buffer,
    raw: { width: tileSize, height: tileSize, channels: 3 },
    left: (i % 2) * tileSize,
    top: Math.floor(i / 2) * tileSize,
  }));
  const canvas = sharp({ create: { width: size, height: size, channels: 3, background: { r: 128, g: 128, b: 255 } } });
  return encode(canvas.composite(composite));
}

async function buildSkinTextures(dir) {
  const fbm = path.join(dir, "unity.fbm");
  const packs = path.join(dir, "textures/unity/unity/CC_Base_Body");
  const base = [];
  const normal = [];
  const orm = [];
  for (const region of REGIONS) {
    base.push(await rgbTile(bmp(path.join(fbm, `${region}_Diffuse.bmp`)), TILE));
    normal.push(await rgbTile(bmp(path.join(fbm, `${region}_Normal.bmp`)), TILE, { flipGreen: true }));
    // Unity HDRP mask: G = ambient occlusion, A = smoothness. glTF ORM: R = AO, G = roughness, B = metallic.
    const ao = bmp(path.join(packs, region, `${region}_ao.bmp`));
    const mask = bmp(path.join(packs, region, `${region}_HDRP.bmp`));
    if (ao.width !== mask.width || mask.channels !== 4) throw new Error(`Unexpected mask layout for ${region}`);
    const packed = Buffer.alloc(ao.width * ao.height * 3);
    for (let i = 0; i < ao.width * ao.height; i++) {
      packed[i * 3] = ao.data[i * ao.channels];
      packed[i * 3 + 1] = 255 - mask.data[i * 4 + 3];
      packed[i * 3 + 2] = 0;
    }
    orm.push(await rgbTile({ width: ao.width, height: ao.height, channels: 3, data: packed }, ORM_TILE));
  }
  const webp = (quality, extra = {}) => (pipeline) => pipeline.webp({ quality, effort: 6, ...extra }).toBuffer();
  return {
    base: await atlas(base, TILE, webp(90)),
    normal: await atlas(normal, TILE, webp(95)),
    orm: await atlas(orm, ORM_TILE, webp(88)),
  };
}

async function smallWebp(image, size, quality, options) {
  const raw = await rgbTile(image, size, options);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).webp({ quality, effort: 6 }).toBuffer();
}

/* ---------- skeleton ---------- */

function buildSkeleton(raw, usedJoints) {
  const bones = raw.bones;
  const children = bones.map(() => []);
  bones.forEach((b, i) => b.parent >= 0 && children[b.parent].push(i));
  const needed = new Set(usedJoints);
  bones.forEach((b, i) => REQUIRED_BONES.includes(b.name) && needed.add(i));
  // Keep every ancestor of a needed bone, so the parent chain stays intact.
  for (const i of [...needed]) for (let p = bones[i].parent; p >= 0 && !needed.has(p); p = bones[p].parent) needed.add(p);
  const keep = bones.map((_, i) => i).filter((i) => needed.has(i));
  const remap = new Map(keep.map((old, i) => [old, i]));
  const dropped = bones.filter((_, i) => !needed.has(i)).map((b) => b.name);
  return { keep, remap, dropped };
}

/** Local bone transforms in metres, with the root rotation baked out and the soles at y = 0. */
function boneTransforms(raw, keep, remap, scale, floor) {
  const rootOld = raw.bones[0];
  const rootQ = quat.fromValues(...rootOld.q);
  const locals = keep.map((old) => {
    const b = raw.bones[old];
    const t = vec3.fromValues(...b.t);
    const q = quat.fromValues(...b.q);
    if (b.parent < 0) {
      // Root: keep the position, drop the rotation.
      return { name: b.name, parent: -1, t: [t[0] * scale, (t[1] - floor) * scale, t[2] * scale], q: [0, 0, 0, 1] };
    }
    if (b.parent === 0) {
      vec3.transformQuat(t, t, rootQ);
      quat.multiply(q, rootQ, q);
    }
    return { name: b.name, parent: remap.get(b.parent), t: [t[0] * scale, t[1] * scale, t[2] * scale], q: [q[0], q[1], q[2], q[3]] };
  });
  // World matrices and inverse binds.
  const worlds = [];
  locals.forEach((b, i) => {
    const local = mat4.fromRotationTranslationScale(mat4.create(), b.q, b.t, [1, 1, 1]);
    worlds[i] = b.parent < 0 ? local : mat4.multiply(mat4.create(), worlds[b.parent], local);
  });
  const inverse = worlds.map((w) => mat4.invert(mat4.create(), w));
  return { locals, worlds, inverse };
}

/* ---------- geometry ---------- */

/**
 * Welds an unindexed triangle soup into an indexed mesh and applies the scale/offset.
 * `uv(i)` returns the final [u, v] of source vertex i.
 */
function weldMesh(meshRaw, ranges, { scale, floor, remapJoint, uv, withUv }) {
  const pos = decode(meshRaw.positions, Float32Array);
  const nor = decode(meshRaw.normals, Float32Array);
  const joints = decode(meshRaw.joints, Uint16Array);
  const weights = decode(meshRaw.weights, Float32Array);
  const outPos = [], outNor = [], outUv = [], outJoints = [], outWeights = [], indices = [];
  const seen = new Map();

  for (const [start, count] of ranges) {
    for (let i = start; i < start + count; i++) {
      const j = [0, 1, 2, 3].map((k) => joints[i * 4 + k]);
      let w = [0, 1, 2, 3].map((k) => weights[i * 4 + k]);
      const sum = w[0] + w[1] + w[2] + w[3];
      if (sum <= 0) throw new Error(`Vertex ${i} has no skin weight.`);
      w = w.map((x) => x / sum);
      const [u, v] = withUv ? uv(i) : [0, 0];
      const key = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], u, v, ...j, ...w].join(",");
      let index = seen.get(key);
      if (index === undefined) {
        index = outPos.length / 3;
        seen.set(key, index);
        outPos.push(pos[i * 3] * scale, (pos[i * 3 + 1] - floor) * scale, pos[i * 3 + 2] * scale);
        const len = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
        outNor.push(nor[i * 3] / len, nor[i * 3 + 1] / len, nor[i * 3 + 2] / len);
        if (withUv) outUv.push(u, v);
        // Drop zero-weight slots to joint 0 so the file never references a removed bone.
        for (let k = 0; k < 4; k++) {
          outJoints.push(w[k] > 0 ? remapJoint(j[k]) : 0);
          outWeights.push(w[k] > 0 ? w[k] : 0);
        }
      }
      indices.push(index);
    }
  }
  const vertexCount = outPos.length / 3;
  return {
    vertexCount,
    triangles: indices.length / 3,
    positions: Float32Array.from(outPos),
    normals: Float32Array.from(outNor),
    uvs: withUv ? Float32Array.from(outUv) : null,
    joints: Uint16Array.from(outJoints),
    weights: Float32Array.from(outWeights),
    indices: vertexCount < 65535 ? Uint16Array.from(indices) : Uint32Array.from(indices),
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Iris and pupil painted around each eye's forward (+Z) axis, for the texture-free lite model. */
function paintEyes(positions) {
  const count = positions.length / 3;
  const colors = new Float32Array(count * 3);
  const sclera = [0.78, 0.74, 0.69];
  const iris = [0.12, 0.2, 0.3];
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

/* ---------- document ---------- */

function createSkeletonNodes(doc, buffer, scene, skeleton) {
  const nodes = skeleton.locals.map((b) => doc.createNode(b.name).setTranslation(b.t).setRotation(b.q));
  skeleton.locals.forEach((b, i) => (b.parent >= 0 ? nodes[b.parent].addChild(nodes[i]) : scene.addChild(nodes[i])));
  const ibm = new Float32Array(nodes.length * 16);
  skeleton.inverse.forEach((m, i) => ibm.set(m, i * 16));
  const skin = doc
    .createSkin("Armature")
    .setSkeleton(nodes[0])
    .setInverseBindMatrices(doc.createAccessor().setType("MAT4").setArray(ibm).setBuffer(buffer));
  nodes.forEach((node) => skin.addJoint(node));
  return skin;
}

function addMesh(doc, buffer, scene, skin, name, geometry, material, extra = {}) {
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor("VEC3", geometry.positions))
    .setAttribute("NORMAL", accessor("VEC3", geometry.normals))
    .setAttribute("JOINTS_0", accessor("VEC4", geometry.joints))
    .setAttribute("WEIGHTS_0", accessor("VEC4", geometry.weights))
    .setIndices(accessor("SCALAR", geometry.indices))
    .setMaterial(material);
  if (geometry.uvs) primitive.setAttribute("TEXCOORD_0", accessor("VEC2", geometry.uvs));
  if (extra.colors) primitive.setAttribute("COLOR_0", accessor("VEC3", extra.colors));
  const mesh = doc.createMesh(name).addPrimitive(primitive);
  const node = doc.createNode(name).setMesh(mesh).setSkin(skin);
  scene.addChild(node);
  return node;
}

/** Creates a WebP texture, attaches it to a material slot and clamps it (no bleeding across atlas tiles). */
function attach(doc, name, image, material, setter, infoGetter) {
  const tex = doc.createTexture(name).setImage(image).setMimeType("image/webp");
  material[setter](tex);
  material[infoGetter]().setWrapS(33071).setWrapT(33071);
  return tex;
}

async function main() {
  const sourceDir = path.resolve(process.argv[2] ?? "");
  if (!process.argv[2] || !fs.existsSync(path.join(sourceDir, "unity.Fbx"))) {
    throw new Error("usage: build.cjs <dir with unity.Fbx, unity.fbm/, textures/> [out dir]");
  }
  const outDir = path.resolve(process.argv[3] ?? path.join(ROOT, "apps/web/public/models"));
  fs.mkdirSync(outDir, { recursive: true });
  // Intermediate files live in the OS temp dir, never next to the served output.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "athlete-male-"));

  log("1/5 reading the FBX in headless Chrome...");
  const raw = await extract(sourceDir, work);

  const body = raw.meshes.CC_Base_Body;
  const bodyGroups = REGIONS.map((name) => {
    const group = body.groups.find((g) => g.material === name);
    if (!group) throw new Error(`Body mesh has no material group ${name}`);
    return { name, group };
  });

  // Height and floor from the skin only.
  const pos = decode(body.positions, Float32Array);
  let minY = Infinity, maxY = -Infinity;
  for (const { group } of bodyGroups) {
    for (let i = group.start; i < group.start + group.count; i++) {
      minY = Math.min(minY, pos[i * 3 + 1]);
      maxY = Math.max(maxY, pos[i * 3 + 1]);
    }
  }
  const scale = STANDING_HEIGHT_M / (maxY - minY);
  log(`   source height ${(maxY - minY).toFixed(2)} cm -> ${STANDING_HEIGHT_M} m (scale ${scale.toFixed(5)}), floor offset ${minY.toFixed(3)} cm`);

  // Which bones carry weight in the meshes we keep.
  const used = new Set();
  const markUsed = (meshRaw, ranges) => {
    const joints = decode(meshRaw.joints, Uint16Array);
    const weights = decode(meshRaw.weights, Float32Array);
    for (const [start, count] of ranges) {
      for (let i = start; i < start + count; i++) for (let k = 0; k < 4; k++) if (weights[i * 4 + k] > 0) used.add(joints[i * 4 + k]);
    }
  };
  const bodyRanges = bodyGroups.map(({ group }) => [group.start, group.count]);
  const boxersRanges = [[0, raw.meshes.Boxers.vertexCount]];
  const eyesRanges = [[0, raw.meshes.CC_Game_Eye.vertexCount]];
  markUsed(body, bodyRanges);
  markUsed(raw.meshes.Boxers, boxersRanges);
  markUsed(raw.meshes.CC_Game_Eye, eyesRanges);

  const { keep, remap, dropped } = buildSkeleton(raw, used);
  const skeleton = boneTransforms(raw, keep, remap, scale, minY);
  log(`   skeleton: ${raw.bones.length} bones read, ${keep.length} kept, ${dropped.length} dropped (${dropped.slice(0, 6).join(", ")}${dropped.length > 6 ? ", ..." : ""})`);

  const common = { scale, floor: minY, remapJoint: (j) => remap.get(j) };
  const bodyUv = decode(body.uvs, Float32Array);
  const regionOfVertex = new Int8Array(body.vertexCount).fill(-1);
  bodyGroups.forEach(({ group }, r) => regionOfVertex.fill(r, group.start, group.start + group.count));
  const skinUv = (i) => {
    const r = regionOfVertex[i];
    const offset = REGION_TILE_OFFSET[REGIONS[r]];
    const u = bodyUv[i * 2] - offset;
    const v = 1 - bodyUv[i * 2 + 1]; // glTF v runs top to bottom
    return [((r % 2) + u) / 2, (Math.floor(r / 2) + v) / 2];
  };
  const wholeUv = (meshRaw) => {
    const uvs = decode(meshRaw.uvs, Float32Array);
    return (i) => [uvs[i * 2], 1 - uvs[i * 2 + 1]];
  };

  log("2/5 welding geometry...");
  const skinGeometry = weldMesh(body, bodyRanges, { ...common, uv: skinUv, withUv: true });
  const boxersGeometry = weldMesh(raw.meshes.Boxers, boxersRanges, { ...common, uv: wholeUv(raw.meshes.Boxers), withUv: true });
  const eyesGeometry = weldMesh(raw.meshes.CC_Game_Eye, eyesRanges, { ...common, uv: wholeUv(raw.meshes.CC_Game_Eye), withUv: true });
  log(`   skin ${skinGeometry.vertexCount} vertices / ${skinGeometry.triangles} triangles, boxers ${boxersGeometry.triangles}, eyes ${eyesGeometry.triangles}`);

  log("3/5 building textures (WebP)...");
  const skinTextures = await buildSkinTextures(sourceDir);
  const fbm = path.join(sourceDir, "unity.fbm");
  const boxersBase = await smallWebp(bmp(path.join(fbm, "Boxers_Diffuse.bmp")), 512, 80);
  const boxersNormal = await smallWebp(bmp(path.join(fbm, "Boxers_Normal.bmp")), 512, 88, { flipGreen: true });
  const eyeBase = await smallWebp(bmp(path.join(fbm, "Ga_Eye_Diffuse.bmp")), 256, 85);
  for (const [name, buf] of Object.entries({ skinBase: skinTextures.base, skinNormal: skinTextures.normal, skinOrm: skinTextures.orm, boxersBase, boxersNormal, eyeBase })) {
    log(`   ${name.padEnd(12)} ${(buf.length / 1024).toFixed(0)} KB`);
  }

  log("4/5 writing glTF...");
  const io = new NodeIO().registerExtensions([EXTTextureWebP]);

  // Full model
  {
    const doc = new Document();
    doc.createExtension(EXTTextureWebP).setRequired(true);
    const buffer = doc.createBuffer();
    const scene = doc.createScene("Athlete");
    doc.getRoot().setDefaultScene(scene);
    const skin = createSkeletonNodes(doc, buffer, scene, skeleton);

    const skinMaterial = doc.createMaterial("AthleteSkin").setMetallicFactor(0).setRoughnessFactor(1);
    attach(doc, "skin-base", skinTextures.base, skinMaterial, "setBaseColorTexture", "getBaseColorTextureInfo");
    attach(doc, "skin-normal", skinTextures.normal, skinMaterial, "setNormalTexture", "getNormalTextureInfo");
    // One ORM texture: R = ambient occlusion, G = roughness, B = metallic.
    const orm = attach(doc, "skin-orm", skinTextures.orm, skinMaterial, "setMetallicRoughnessTexture", "getMetallicRoughnessTextureInfo");
    skinMaterial.setOcclusionTexture(orm).setOcclusionStrength(1);
    skinMaterial.getOcclusionTextureInfo().setWrapS(33071).setWrapT(33071);

    const boxersMaterial = doc.createMaterial("AthleteBoxers").setMetallicFactor(0).setRoughnessFactor(0.62);
    attach(doc, "boxers-base", boxersBase, boxersMaterial, "setBaseColorTexture", "getBaseColorTextureInfo");
    attach(doc, "boxers-normal", boxersNormal, boxersMaterial, "setNormalTexture", "getNormalTextureInfo");

    const eyeMaterial = doc.createMaterial("AthleteEyes").setMetallicFactor(0).setRoughnessFactor(0.14);
    attach(doc, "eye-base", eyeBase, eyeMaterial, "setBaseColorTexture", "getBaseColorTextureInfo");

    addMesh(doc, buffer, scene, skin, "AthleteBody", skinGeometry, skinMaterial);
    addMesh(doc, buffer, scene, skin, "AthleteBoxers", boxersGeometry, boxersMaterial);
    addMesh(doc, buffer, scene, skin, "AthleteEyes", eyesGeometry, eyeMaterial);
    await io.write(path.join(work, "athlete-male.raw.glb"), doc);
  }

  // Lite model: same skeleton and geometry, no textures, no UVs.
  {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene("AthleteLite");
    doc.getRoot().setDefaultScene(scene);
    const skin = createSkeletonNodes(doc, buffer, scene, skeleton);
    const plain = (name, color, roughness) =>
      doc.createMaterial(name).setBaseColorFactor([...color, 1]).setMetallicFactor(0).setRoughnessFactor(roughness);
    const strip = (g) => ({ ...g, uvs: null });
    addMesh(doc, buffer, scene, skin, "AthleteBody", strip(skinGeometry), plain("AthleteSkinLite", [0.62, 0.7, 0.66], 0.62));
    addMesh(doc, buffer, scene, skin, "AthleteBoxers", strip(boxersGeometry), plain("AthleteBoxersLite", [0.1, 0.12, 0.13], 0.7));
    addMesh(doc, buffer, scene, skin, "AthleteEyes", strip(eyesGeometry), plain("AthleteEyesLite", [1, 1, 1], 0.35), {
      colors: paintEyes(eyesGeometry.positions),
    });
    await io.write(path.join(work, "athlete-male-lite.raw.glb"), doc);
  }

  log("5/5 compressing with @gltf-transform/cli (Meshopt)...");
  const cli = path.join(__dirname, "node_modules/@gltf-transform/cli/bin/cli.js");
  const compress = (name) => {
    execFileSync(
      process.execPath,
      [
        cli, "meshopt", path.join(work, `${name}.raw.glb`), path.join(outDir, `${name}.glb`),
        "--level", "high",
        "--quantize-position", "14", "--quantize-normal", "10", "--quantize-texcoord", "14",
        "--quantize-weight", "12", "--quantize-color", "8",
      ],
      { stdio: "inherit" },
    );
  };
  compress("athlete-male");
  compress("athlete-male-lite");

  const report = {
    standingHeightM: STANDING_HEIGHT_M,
    bones: keep.length,
    droppedBones: dropped,
    skin: { vertices: skinGeometry.vertexCount, triangles: skinGeometry.triangles },
    boxers: { triangles: boxersGeometry.triangles },
    eyes: { triangles: eyesGeometry.triangles },
    files: Object.fromEntries(
      ["athlete-male.glb", "athlete-male-lite.glb"].map((f) => [f, fs.statSync(path.join(outDir, f)).size]),
    ),
  };
  fs.rmSync(work, { recursive: true, force: true });
  log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
