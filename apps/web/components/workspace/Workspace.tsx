"use client";

import { useCallback, useState } from "react";
import type { DemoId } from "@/lib/assets";
import { AssetNotes } from "./AssetNotes";
import { GuidancePanel } from "./GuidancePanel";
import { StagePanel } from "./StagePanel";
import { TopBar } from "./TopBar";
import styles from "./Workspace.module.css";

const DEFAULT_DEMO: DemoId = "movement";
const VIEW_PARAM = "view";

type WorkspaceProps = {
  initialDemo?: DemoId;
};

export function Workspace({ initialDemo = DEFAULT_DEMO }: WorkspaceProps) {
  const [activeDemo, setActiveDemo] = useState<DemoId>(initialDemo);
  const [notesOpen, setNotesOpen] = useState(false);

  const changeDemo = useCallback((id: DemoId) => {
    setActiveDemo(id);
    const url = new URL(window.location.href);
    if (id === DEFAULT_DEMO) url.searchParams.delete(VIEW_PARAM);
    else url.searchParams.set(VIEW_PARAM, id);
    window.history.replaceState(null, "", url);
  }, []);

  const openNotes = useCallback(() => setNotesOpen(true), []);
  const closeNotes = useCallback(() => setNotesOpen(false), []);

  return (
    <div className={styles.shell}>
      <TopBar onOpenAssets={openNotes} />
      <main className={styles.workspace} aria-label="3D demonstration workspace">
        <div className={styles.stagePane}>
          <StagePanel activeDemo={activeDemo} onChangeDemo={changeDemo} />
        </div>
        <div className={styles.guidancePane}>
          <GuidancePanel activeDemo={activeDemo} />
        </div>
      </main>
      <AssetNotes open={notesOpen} onClose={closeNotes} />
    </div>
  );
}
