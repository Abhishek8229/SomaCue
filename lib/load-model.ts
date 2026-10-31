"use client";

import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const cache = new Map<string, Promise<GLTF>>();
let loader: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader();
  return loader;
}

/**
 * Load a GLB once per session. A rejected promise is evicted so a retry can
 * ask the network again instead of receiving the cached failure.
 */
export function loadModel(url: string): Promise<GLTF> {
  const hit = cache.get(url);
  if (hit) return hit;

  const request = new Promise<GLTF>((resolve, reject) => {
    getLoader().load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(`Could not load ${url}`)),
    );
  });

  cache.set(url, request);
  request.catch(() => cache.delete(url));
  return request;
}
