"use client";

import { useCallback, useEffect } from "react";

const THEME_KEY = "somacue.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function applyTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
}

/**
 * While no manual choice is stored, keep the page in step with the system.
 * The prepaint script in the layout sets the first value.
 */
export function useSystemTheme() {
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const sync = () => {
      try {
        if (window.localStorage.getItem(THEME_KEY)) return;
      } catch {
        return;
      }
      applyTheme(media.matches ? "dark" : "light");
    };

    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
}

export function useThemeToggle() {
  return useCallback(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // The choice lasts for this page even when storage is unavailable.
    }
  }, []);
}
