"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

function format(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}

/**
 * A timestamp in the viewer's own time zone. The server and the first client
 * render use UTC so they match; the browser then swaps in its local date.
 */
export function LocalDate({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(iso),
    () => format(iso, "UTC"),
  );
  return <time dateTime={iso}>{text}</time>;
}

/** A YYYY-MM-DD day key as text. Day keys have no time zone, so UTC is exact. */
export function formatDayKey(dateKey: string, withYear = false) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}
