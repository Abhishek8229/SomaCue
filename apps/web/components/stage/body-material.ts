import { Color, MeshStandardMaterial, Vector3 } from "three";

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

/**
 * Matte clinical mannequin material: standard PBR plus an emerald fresnel rim
 * and up to eight capsule-shaped region glows computed in the fragment shader.
 * Works with skinning, so the glow follows the animated joints.
 */
export function createBodyMaterial(baseColor: string, rimColor: string) {
  const material = new MeshStandardMaterial({
    color: new Color(baseColor),
    roughness: 0.68,
    metalness: 0,
    envMapIntensity: 0.22,
  });

  const uniforms: GlowUniforms = {
    uGlowA: { value: Array.from({ length: MAX_GLOWS }, () => new Vector3()) },
    uGlowB: { value: Array.from({ length: MAX_GLOWS }, () => new Vector3()) },
    uGlowR: { value: Array.from({ length: MAX_GLOWS }, () => 0.1) },
    uGlowColor: { value: Array.from({ length: MAX_GLOWS }, () => new Color(0, 0, 0)) },
    uGlowCount: { value: 0 },
    uRimColor: { value: new Color(rimColor) },
    uRimStrength: { value: 0.22 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSomaWorld;")
      .replace(
        "#include <skinning_vertex>",
        "#include <skinning_vertex>\nvSomaWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
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
totalEmissiveRadiance += somaGlow + uRimColor * smoothstep(0.08, 1.0, somaRim) * uRimStrength;`,
      );
  };
  material.customProgramCacheKey = () => "soma-body-glow-v3";

  return { material, uniforms };
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
