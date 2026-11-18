/**
 * Textured Character Creator 4 athlete body: WebP textures, Meshopt-compressed.
 * Built by scripts/athlete-male/build.cjs. See docs/3d-engine/asset-register.md.
 */
export const BODY_ASSET_URL = "/models/athlete-male.glb";

/**
 * The same skeleton and geometry without textures or UVs. Used by headless code
 * (tests, server actions, verify:motion) and as the render fallback when the
 * textured body cannot load.
 */
export const BODY_LITE_ASSET_URL = "/models/athlete-male-lite.glb";
