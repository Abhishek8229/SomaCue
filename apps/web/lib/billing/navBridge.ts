"use client";

import { useSyncExternalStore } from "react";

/*
 * Lets the site-wide Navbar (rendered by the root layout) show the "Upgrade to Pro" button for
 * the workspace without knowing about billing: the workspace publishes whether the user is on
 * Free and how to open the Upgrade dialog, and the Navbar reads it.
 */

export type UpgradeNavState = { visible: boolean; open: (() => void) | null };

const HIDDEN: UpgradeNavState = { visible: false, open: null };
let state: UpgradeNavState = HIDDEN;
const listeners = new Set<() => void>();

export function publishUpgradeNav(next: UpgradeNavState | null) {
  state = next ?? HIDDEN;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpgradeNav(): UpgradeNavState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => HIDDEN,
  );
}
