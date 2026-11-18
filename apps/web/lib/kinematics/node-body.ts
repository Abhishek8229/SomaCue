import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BODY_LITE_ASSET_URL } from "./body-asset";
import { createBodyRig, type BodyRig } from "./rig";

/**
 * Loads the body headless (server actions, tests and verify:motion). It reads
 * the texture-free lite GLB, so GLTFLoader.parse needs no DOM and no image
 * decoding. The skeleton and geometry are identical to the textured body.
 */
let template: Promise<Object3D> | null = null;

function loadTemplate(publicDir: string) {
  if (!template) {
    template = (async () => {
      const file = await readFile(join(publicDir, BODY_LITE_ASSET_URL));
      // Hand the loader a realm-independent copy: under jsdom a Node ArrayBuffer fails
      // `instanceof ArrayBuffer` and GLTFLoader would read the binary as JSON.
      const data = new Uint8Array(file).buffer as ArrayBuffer;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return new Promise<Object3D>((resolve, reject) => {
        loader.parse(data, "", (gltf) => resolve(gltf.scene), reject);
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
