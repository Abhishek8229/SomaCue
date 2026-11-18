import { Color, DoubleSide, MeshStandardMaterial, Vector3, type Material, type Object3D, type SkinnedMesh } from "three";

export const MAX_GLOWS = 8;

export type GlowUniforms = {
  uGlowA: { value: Vector3[] };
  uGlowB: { value: Vector3[] };
  uGlowR: { value: number[] };
  uGlowColor: { value: Color[] };
  uGlowCount: { value: number };
  uRimColor: { value: Color };
  uRimStrength: { value: number };
};

export function createGlowUniforms(rimColor: string): GlowUniforms {
  return {
    uGlowA: { value: Array.from({ length: MAX_GLOWS }, () => new Vector3()) },
    uGlowB: { value: Array.from({ length: MAX_GLOWS }, () => new Vector3()) },
    uGlowR: { value: Array.from({ length: MAX_GLOWS }, () => 0.1) },
    uGlowColor: { value: Array.from({ length: MAX_GLOWS }, () => new Color(0, 0, 0)) },
    uGlowCount: { value: 0 },
    uRimColor: { value: new Color(rimColor) },
    uRimStrength: { value: 0.22 },
  };
}

/**
 * Adds an emerald fresnel rim and up to eight capsule-shaped region glows,
 * computed in the fragment shader, to a standard material. Works with
 * skinning, so the glow follows the animated joints. All patched materials
 * share one set of uniforms.
 */
export type GlowOptions = {
  /** scales the region glow (dark cloth reads as a solid block at full strength) */
  gain?: number;
  /** pushes the surface out along its normal, in metres, so skin cannot poke through clothing */
  inflate?: number;
};

export function addGlow(material: MeshStandardMaterial, uniforms: GlowUniforms, cacheKey: string, options: GlowOptions = {}) {
  const gain = (options.gain ?? 1).toFixed(3);
  const inflate = (options.inflate ?? 0).toFixed(4);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSomaWorld;")
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>\ntransformed += normalize(objectNormal) * ${inflate};\nvSomaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vSomaWorld;
uniform vec3 uGlowA[${MAX_GLOWS}];
uniform vec3 uGlowB[${MAX_GLOWS}];
uniform float uGlowR[${MAX_GLOWS}];
uniform vec3 uGlowColor[${MAX_GLOWS}];
uniform int uGlowCount;
uniform vec3 uRimColor;
uniform float uRimStrength;
float somaSegmentDistance(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - (a + ab * t));
}`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
vec3 somaGlow = vec3(0.0);
for (int i = 0; i < ${MAX_GLOWS}; i++) {
  if (i >= uGlowCount) break;
  float d = somaSegmentDistance(vSomaWorld, uGlowA[i], uGlowB[i]);
  float g = 1.0 - smoothstep(uGlowR[i] * 0.45, uGlowR[i] * 1.25, d);
  somaGlow += uGlowColor[i] * g;
}
float somaRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.6);
totalEmissiveRadiance += somaGlow * ${gain} + uRimColor * smoothstep(0.08, 1.0, somaRim) * uRimStrength;`,
      );
  };
  material.customProgramCacheKey = () => `${cacheKey}-g${gain}-i${inflate}`;
}

/**
 * Flat matte mannequin material, used when only the texture-free body is
 * available (the render fallback).
 */
export function createBodyMaterial(baseColor: string, uniforms: GlowUniforms) {
  const material = new MeshStandardMaterial({
    color: new Color(baseColor),
    roughness: 0.68,
    metalness: 0,
    envMapIntensity: 0.22,
  });
  addGlow(material, uniforms, "soma-body-glow-v3");
  return material;
}

/** Boxers: a calmer glow, and pushed out a few millimetres so deep hip folds do not show skin through. */
const BOXERS_GLOW: GlowOptions = { gain: 0.4, inflate: 0.004 };

/**
 * Gives every skinned mesh of the model its own material for this stage:
 * textured materials keep their maps exactly as authored (the skin is not
 * re-tinted or re-tuned) and get the glow and rim; texture-free (lite)
 * materials are replaced by the flat mannequin. Returns the materials so the
 * caller can dispose them. Textures are shared with the loaded model and are
 * left alone.
 */
export function dressBody(model: Object3D, baseColor: string, uniforms: GlowUniforms): Material[] {
  const created: Material[] = [];
  model.traverse((object) => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const source = mesh.material as MeshStandardMaterial;
    let material: MeshStandardMaterial;
    if (source.name === "AthleteSkinLite") {
      material = createBodyMaterial(baseColor, uniforms);
    } else {
      material = source.clone();
      // The body mesh is open at the fingertips (the nails were a separate mesh): fill them.
      if (source.name === "AthleteSkin") material.side = DoubleSide;
      // The eyes keep their own look; textured skin and clothing get the glow.
      if (source.map && source.name !== "AthleteEyes") {
        addGlow(material, uniforms, `soma-athlete-glow-${source.name}`, source.name === "AthleteBoxers" ? BOXERS_GLOW : undefined);
      }
    }
    mesh.material = material;
    created.push(material);
  });
  return created;
}

export type GlowEntry = { a: Vector3; b: Vector3; radius: number; color: Color };

/** Upload this frame's region glows. Three.js uniforms are mutable by design. */
export function writeGlows(uniforms: GlowUniforms, entries: readonly GlowEntry[]) {
  const count = Math.min(MAX_GLOWS, entries.length);
  for (let i = 0; i < count; i++) {
    uniforms.uGlowA.value[i].copy(entries[i].a);
    uniforms.uGlowB.value[i].copy(entries[i].b);
    uniforms.uGlowR.value[i] = entries[i].radius;
    uniforms.uGlowColor.value[i].copy(entries[i].color);
  }
  uniforms.uGlowCount.value = count;
}
