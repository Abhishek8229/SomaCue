"use client";

import { useSystemTheme, useThemeToggle } from "@/lib/theme";
import { NotesIcon, SunIcon, MoonIcon } from "./icons";
import styles from "./TopBar.module.css";

type TopBarProps = {
  onOpenAssets: () => void;
};

export function TopBar({ onOpenAssets }: TopBarProps) {
  useSystemTheme();
  const toggleTheme = useThemeToggle();

  return (
    <header className={styles.topBar}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>SomaCue</span>
        <span className={styles.context}>Clinical 3D workspace</span>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.assetButton} onClick={onOpenAssets}>
          <NotesIcon size={16} />
          Resources
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={styles.themeButton}
          onClick={toggleTheme}
          aria-label="Switch colour theme"
          title="Switch colour theme"
        >
          <SunIcon size={18} className={styles.iconSun} />
          <MoonIcon size={18} className={styles.iconMoon} />
        </button>
      </div>
    </header>
  );
}
