"use client";

import { useSyncExternalStore } from "react";

export type WebGLState = "checking" | "available" | "unavailable";

let webglState: WebGLState | null = null;

function detectWebGL(): WebGLState {
  if (webglState) return webglState;

  let context: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  } catch {
    context = null;
  }

  webglState = context ? "available" : "unavailable";
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  return webglState;
}

const subscribeNothing = () => () => {};

export function useWebGLSupport(): WebGLState {
  return useSyncExternalStore(subscribeNothing, detectWebGL, () => "checking");
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}
