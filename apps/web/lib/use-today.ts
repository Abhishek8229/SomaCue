"use client";

import { useSyncExternalStore } from "react";
import { toDateKey } from "@/lib/progress/dailyProgress";

function subscribe(onChange: () => void) {
  // The clock is the source of truth, so check it often and whenever the tab
  // comes back. A tab left open past midnight moves on to the new day.
  const timer = window.setInterval(onChange, 30_000);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Today's date in the viewer's own time zone, as YYYY-MM-DD. The server render
 * uses UTC so both renders agree first; the browser's local day replaces it.
 */
export function useLocalToday(): string {
  return useSyncExternalStore(
    subscribe,
    () => toDateKey(new Date()),
    () => new Date().toISOString().slice(0, 10),
  );
}

/** Minutes the viewer's clock is behind UTC. The server render assumes UTC so both renders agree first. */
export function useLocalUtcOffset(): number {
  return useSyncExternalStore(
    () => () => {},
    () => new Date().getTimezoneOffset(),
    () => 0,
  );
}
