"use client";

import type { Object3D } from "three";
import { BODY_ASSET_URL, BODY_LITE_ASSET_URL } from "@/lib/kinematics/body-asset";
import { loadModel } from "@/lib/load-model";

/**
 * The body every 3D view on the site renders: the textured CC4 athlete, or the
 * texture-free copy of it when the textured file cannot load (decoder, WebP,
 * network). Both files are cached per session, so the hero preview and the
 * movement stage share one download.
 */
export function loadBodyTemplate(): Promise<Object3D> {
  return loadModel(BODY_ASSET_URL)
    .catch((error: unknown) => {
      console.warn("The textured body did not load, using the plain body.", error);
      return loadModel(BODY_LITE_ASSET_URL);
    })
    .then((gltf) => gltf.scene);
}
