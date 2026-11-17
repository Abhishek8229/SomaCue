import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BODY_ASSET_URL } from "./body-asset";
import { createBodyRig, type BodyRig } from "./rig";

/**
 * Loads the body headless (server actions, tests and verify:motion). The
 * GLB has no textures, so GLTFLoader.parse works without a DOM.
 */
let template: Promise<Object3D> | null = null;

function loadTemplate(publicDir: string) {
  if (!template) {
    template = (async () => {
      const file = await readFile(join(publicDir, BODY_ASSET_URL));
      const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
      return new Promise<Object3D>((resolve, reject) => {
        new GLTFLoader().parse(data, "", (gltf) => resolve(gltf.scene), reject);
      });
    })();
    template.catch(() => {
      template = null;
    });
  }
  return template;
}

export async function loadBodyRigNode(publicDir = join(process.cwd(), "public")): Promise<BodyRig> {
  const scene = await loadTemplate(publicDir);
  return createBodyRig(cloneSkinned(scene));
}
