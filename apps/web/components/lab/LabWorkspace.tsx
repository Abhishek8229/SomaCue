"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ATLAS_SYSTEMS, type AtlasSystemId } from "@/lib/lab/atlas-loader";
import { LAB_ASSETS, LAB_SUPPORTING } from "@/lib/lab/lab-assets";
import {
  createLabScene,
  DEFAULT_SYSTEMS,
  type LabScene,
} from "@/lib/lab/lab-runtime";
import { SYSTEM_STYLE } from "@/lib/lab/lab-skinning";
import type { LabStatus, PoseMode, SkinMode } from "@/lib/lab/lab-types";
import { useWebGLSupport } from "@/lib/use-environment";
import { LabResultsPanel } from "./LabResultsPanel";
import type { LabView, LabViewCommand } from "./LabStage";
import styles from "./Lab.module.css";

const LabStage = dynamic(() => import("./LabStage"), { ssr: false });

const SPEEDS = [0.25, 0.5, 1];
const VIEWS: Array<{ id: LabView; label: string }> = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "back", label: "Back" },
  { id: "torso", label: "Torso" },
  { id: "reset", label: "Reset" },
];

declare global {
  interface Window {
    __somacueLab?: { lab: LabScene; results: LabScene["results"] };
  }
}

export function LabWorkspace() {
  const webgl = useWebGLSupport();
  const [status, setStatus] = useState<LabStatus>({ phase: "idle" });
  const [lab, setLab] = useState<LabScene | null>(null);
  const [rigVisible, setRigVisible] = useState(true);
  const [atlasVisible, setAtlasVisible] = useState(true);
  const [skinMode, setSkinMode] = useState<SkinMode>("solid");
  const [systems, setSystems] = useState<Record<AtlasSystemId, boolean>>(
    () =>
      Object.fromEntries(
        ATLAS_SYSTEMS.map((id) => [id, DEFAULT_SYSTEMS.has(id)]),
      ) as Record<AtlasSystemId, boolean>,
  );
  const [pose, setPose] = useState<PoseMode>("matched");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [command, setCommand] = useState<LabViewCommand>({
    id: 0,
    view: "reset",
  });

  useEffect(() => {
    if (webgl !== "available") return;
    const abort = new AbortController();
    let created: LabScene | null = null;
    createLabScene(setStatus, abort.signal)
      .then((scene) => {
        if (abort.signal.aborted) {
          scene.dispose();
          return;
        }
        created = scene;
        window.__somacueLab = { lab: scene, results: scene.results };
        setLab(scene);
        setStatus({ phase: "ready" });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.error("The 3D lab could not be built.", error);
        setStatus({
          phase: "error",
          message:
            error instanceof Error
              ? error.message
              : "The 3D lab could not be built.",
        });
      });
    return () => {
      abort.abort();
      created?.dispose();
      delete window.__somacueLab;
    };
  }, [webgl]);

  const onTime = useCallback((seconds: number) => setTime(seconds), []);
  const ready = status.phase === "ready" && lab !== null;

  const toggleRig = (value: boolean) => {
    setRigVisible(value);
    lab?.setRigVisible(value);
  };
  const toggleAtlas = (value: boolean) => {
    setAtlasVisible(value);
    lab?.setAtlasVisible(value);
  };
  const chooseSkin = (mode: SkinMode) => {
    setSkinMode(mode);
    lab?.setSkinMode(mode);
  };
  const toggleSystem = (id: AtlasSystemId, value: boolean) => {
    setSystems((current) => ({ ...current, [id]: value }));
    lab?.setSystemVisible(id, value);
  };
  const choosePose = (mode: PoseMode) => {
    setPose(mode);
    setPlaying(false);
    setTime(0);
    lab?.setPose(mode);
  };
  const togglePlay = () => {
    if (!lab) return;
    const next = !playing;
    setPlaying(next);
    setPose("clip");
    lab.setPlaying(next);
    // The stage reports time on a throttle; settle the readout at the moment of the click.
    setTime(lab.time());
  };
  const scrub = (seconds: number) => {
    if (!lab) return;
    setPose("clip");
    setPlaying(false);
    setTime(seconds);
    lab.seek(seconds);
  };
  const changeSpeed = (value: number) => {
    setSpeed(value);
    lab?.setSpeed(value);
  };

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div>
          <p className={styles.kicker}>
            Experimental · not part of the product
          </p>
          <h1 className={styles.title}>
            3D lab: can these assets form one body?
          </h1>
        </div>
        <Link href="/" className={styles.back}>
          Back to the demonstration
        </Link>
      </header>

      <main className={styles.main}>
        <aside className={styles.rail} aria-label="Lab controls and results">
          <section className={styles.section} aria-labelledby="lab-models">
            <h2 id="lab-models" className={styles.heading}>
              Models
            </h2>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={atlasVisible}
                disabled={!ready}
                onChange={(event) => toggleAtlas(event.currentTarget.checked)}
                aria-label="Show Human Atlas anatomy"
              />
              <span>Human Atlas anatomy</span>
            </label>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={rigVisible}
                disabled={!ready}
                onChange={(event) => toggleRig(event.currentTarget.checked)}
                aria-label="Show Innerscene human"
              />
              <span>Innerscene human</span>
            </label>
            <div
              className={styles.group}
              role="group"
              aria-label="Innerscene surface"
            >
              {(["solid", "ghost"] as SkinMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={styles.chip}
                  aria-pressed={skinMode === mode}
                  disabled={!ready || !rigVisible}
                  onClick={() => chooseSkin(mode)}
                >
                  {mode === "solid" ? "Solid skin" : "Ghost skin"}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="lab-layers">
            <h2 id="lab-layers" className={styles.heading}>
              Atlas layers
            </h2>
            <div className={styles.layers}>
              {ATLAS_SYSTEMS.map((id) => (
                <label key={id} className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={systems[id]}
                    disabled={!ready}
                    onChange={(event) =>
                      toggleSystem(id, event.currentTarget.checked)
                    }
                  />
                  <span
                    className={styles.swatch}
                    style={{ background: SYSTEM_STYLE[id].color }}
                    aria-hidden="true"
                  />
                  <span>{SYSTEM_STYLE[id].label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="lab-motion">
            <h2 id="lab-motion" className={styles.heading}>
              Pose and movement
            </h2>
            <div className={styles.group} role="group" aria-label="Pose">
              <button
                type="button"
                className={styles.chip}
                aria-pressed={pose === "matched"}
                disabled={!ready}
                onClick={() => choosePose("matched")}
              >
                Matched rest
              </button>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={pose === "native"}
                disabled={!ready}
                onClick={() => choosePose("native")}
              >
                Native A-pose
              </button>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={pose === "clip"}
                disabled={!ready}
                onClick={() => choosePose("clip")}
              >
                Jumping jacks
              </button>
            </div>
            <div className={styles.transport}>
              <button
                type="button"
                className={styles.primary}
                disabled={!ready}
                onClick={togglePlay}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <label className={styles.scrubWrap}>
                <span className="visually-hidden">Clip position</span>
                <input
                  type="range"
                  min={0}
                  max={lab?.duration ?? 1}
                  step={0.01}
                  value={Math.min(time, lab?.duration ?? 1)}
                  disabled={!ready}
                  onChange={(event) => scrub(Number(event.currentTarget.value))}
                />
              </label>
              <output className={styles.time} data-testid="lab-time">
                {time.toFixed(2)} s
              </output>
            </div>
            <div
              className={styles.group}
              role="group"
              aria-label="Playback speed"
            >
              {SPEEDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={styles.chip}
                  aria-pressed={speed === value}
                  disabled={!ready}
                  onClick={() => changeSpeed(value)}
                >
                  {value}×
                </button>
              ))}
            </div>
            <p className={styles.note}>
              A technical movement test. It shows whether the anatomy follows
              the skeleton, not how an exercise should be performed.
            </p>
          </section>

          <section className={styles.section} aria-labelledby="lab-camera">
            <h2 id="lab-camera" className={styles.heading}>
              Camera
            </h2>
            <div className={styles.group} role="group" aria-label="Camera view">
              {VIEWS.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  className={styles.chip}
                  onClick={() =>
                    setCommand((current) => ({
                      id: current.id + 1,
                      view: view.id,
                    }))
                  }
                >
                  {view.label}
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section} aria-labelledby="lab-results">
            <h2 id="lab-results" className={styles.heading}>
              Alignment and movement tests
            </h2>
            {status.phase === "ready" && lab ? (
              <LabResultsPanel results={lab.results} />
            ) : status.phase === "error" ? (
              <p className={styles.error} role="alert">
                {status.message}
              </p>
            ) : (
              <p className={styles.note}>
                Results appear when the models have loaded and been measured.
              </p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="lab-sources">
            <h2 id="lab-sources" className={styles.heading}>
              Sources and attribution
            </h2>
            <ul className={styles.sources}>
              {LAB_ASSETS.map((asset) => (
                <li key={asset.id}>
                  <p className={styles.sourceTitle}>{asset.title}</p>
                  <p className={styles.note}>{asset.role}</p>
                  <p className={styles.attribution}>
                    {asset.licence.attribution}
                  </p>
                  <p className={styles.note}>
                    <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                      <span className="visually-hidden">
                        {" "}
                        (opens in a new tab)
                      </span>
                    </a>
                    {" · "}
                    <a
                      href={asset.licence.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {asset.licence.name.split(";")[0]}
                      <span className="visually-hidden">
                        {" "}
                        (opens in a new tab)
                      </span>
                    </a>
                  </p>
                </li>
              ))}
            </ul>
            {LAB_SUPPORTING.map((line) => (
              <p key={line} className={styles.note}>
                {line}
              </p>
            ))}
            <p className={styles.note}>
              Full register: docs/3d-lab/asset-register.md
            </p>
          </section>
        </aside>

        <section className={styles.stage} aria-label="3D stage">
          {webgl === "unavailable" ? (
            <div className={styles.overlay} role="alert">
              <p className={styles.overlayTitle}>
                3D is unavailable in this browser.
              </p>
              <p className={styles.overlayCopy}>The lab needs WebGL.</p>
            </div>
          ) : (
            <div className={styles.canvas} aria-hidden="true">
              <LabStage lab={lab} command={command} onTime={onTime} />
            </div>
          )}
          {status.phase === "loading" ? (
            <div
              className={styles.overlay}
              role="status"
              aria-live="polite"
              data-testid="lab-loading"
            >
              <p className={styles.overlayTitle}>{status.label}</p>
              <progress
                className={styles.progress}
                value={status.progress}
                max={1}
              />
              <p className={styles.overlayCopy}>
                The anatomy is 33 MB compressed and is skinned to the skeleton
                in the browser.
              </p>
            </div>
          ) : null}
          {status.phase === "error" ? (
            <div className={styles.overlay} role="alert">
              <p className={styles.overlayTitle}>The lab could not be built.</p>
              <p className={styles.overlayCopy}>{status.message}</p>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
