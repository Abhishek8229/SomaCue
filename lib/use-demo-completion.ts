"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { DemoId } from "@/lib/assets";

const COMPLETION_EVENT = "somacue:completion";
const keyFor = (id: DemoId) => `somacue.demo.${id}.complete`;

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(COMPLETION_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(COMPLETION_EVENT, callback);
  };
}

export function useDemoCompletion(id: DemoId) {
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(keyFor(id)) === "1";
    } catch {
      return false;
    }
  }, [id]);

  const complete = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const toggle = useCallback(() => {
    try {
      if (complete) window.localStorage.removeItem(keyFor(id));
      else window.localStorage.setItem(keyFor(id), "1");
    } catch {
      // The mark still changes for this view when storage is unavailable.
    }
    window.dispatchEvent(new Event(COMPLETION_EVENT));
  }, [complete, id]);

  return { complete, toggle };
}
