"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DEMOS, DEMO_ORDER, type DemoId } from "@/lib/assets";
import { formatSeconds } from "@/lib/format";
import type { ModelStatus, SeekCommand, ViewCommand } from "@/lib/stage-types";
import { usePrefersReducedMotion, useWebGLSupport } from "@/lib/use-environment";
import {
  AlertIcon,
  ChevronDownIcon,
  CubeIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ReplayIcon,
  ResetIcon,
  TextIcon,
} from "./icons";
import styles from "./StagePanel.module.css";

const StageCanvas = dynamic(() => import("./StageCanvas"), { ssr: false });

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

type StagePanelProps = {
  activeDemo: DemoId;
  onChangeDemo: (id: DemoId) => void;
};

export function StagePanel({ activeDemo, onChangeDemo }: StagePanelProps) {
  const demo = DEMOS[activeDemo];
  const tabId = useId();
  const webgl = useWebGLSupport();
  const reducedMotion = usePrefersReducedMotion();
  const [status, setStatus] = useState<ModelStatus>("loading");
  const [textMode, setTextMode] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [seek, setSeek] = useState<SeekCommand>({ id: 0, seconds: 0 });
  const [viewCommand, setViewCommand] = useState<ViewCommand>({ id: 0, type: "reset" });
  const tabRefs = useRef<Record<DemoId, HTMLButtonElement | null>>({
    movement: null,
    anatomy: null,
  });

  const isMovement = activeDemo === "movement";
  const duration = isMovement ? DEMOS.movement.clip.durationSeconds : 0;
  const ready = status === "ready";
  const staticMode = textMode || webgl === "unavailable";
  const busy = webgl === "checking" || (!staticMode && status === "loading");

  const selectDemo = (id: DemoId) => {
    if (id === activeDemo) return;
    setStatus("loading");
    setPlaying(false);
    setTime(0);
    setSpeed(1);
    setSeek({ id: 0, seconds: 0 });
    setTextMode(false);
    setViewCommand((current) => ({ id: current.id + 1, type: "reset" }));
    onChangeDemo(id);
  };

  const handleStatus = useCallback((next: ModelStatus) => {
    setStatus(next);
  }, []);

  const handleTime = useCallback((seconds: number) => {
    setTime(seconds);
  }, []);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setTime(duration);
  }, [duration]);

  const issueView = (type: ViewCommand["type"]) => {
    setViewCommand((current) => ({ id: current.id + 1, type }));
  };

  const togglePlayback = () => {
    if (!ready) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (time >= duration - 0.02) {
      setSeek((current) => ({ id: current.id + 1, seconds: 0 }));
      setTime(0);
    }
    setPlaying(true);
  };

  const replay = () => {
    if (!ready) return;
    setSeek((current) => ({ id: current.id + 1, seconds: 0 }));
    setTime(0);
    setPlaying(true);
  };

  const scrub = (seconds: number) => {
    if (!ready) return;
    setTime(seconds);
    setSeek((current) => ({ id: current.id + 1, seconds }));
  };

  const toggleTextMode = () => {
    if (webgl === "unavailable") return;
    setPlaying(false);
    setTime(0);
    setSeek((current) => ({ id: current.id + 1, seconds: 0 }));
    if (textMode) setStatus("loading");
    setTextMode((current) => !current);
  };

  const retry = () => {
    setPlaying(false);
    setTime(0);
    setSeek((current) => ({ id: current.id + 1, seconds: 0 }));
    setTextMode(false);
    setStatus("loading");
    setRetryKey((current) => current + 1);
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % DEMO_ORDER.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + DEMO_ORDER.length) % DEMO_ORDER.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = DEMO_ORDER.length - 1;
    else return;

    event.preventDefault();
    const next = DEMO_ORDER[nextIndex];
    selectDemo(next);
    tabRefs.current[next]?.focus();
  };

  const stateLabel =
    webgl === "checking"
      ? "Checking 3D"
      : webgl === "unavailable"
        ? "Static"
        : staticMode
          ? "Static"
          : status === "loading"
            ? "Loading"
            : status === "error"
              ? "Failed"
              : isMovement && playing
                ? "Playing"
                : isMovement
                  ? "Paused"
                  : "Interactive";

  const fallbackNotice =
    webgl === "unavailable"
      ? "3D is unavailable in this browser. This still frame comes from the same build."
      : status === "error"
        ? "The live model stopped. Showing a still frame from this build."
        : "Static view. The 3D model is hidden.";

  return (
    <section className={styles.stage} aria-label="3D demonstration stage">
      <div className={styles.head}>
        <div className={styles.tabs} role="tablist" aria-label="Demonstration">
          {DEMO_ORDER.map((id, index) => {
            const item = DEMOS[id];
            const selected = id === activeDemo;
            return (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current[id] = node;
                }}
                id={`${tabId}-${id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${tabId}-panel`}
                tabIndex={selected ? 0 : -1}
                className={styles.tab}
                onClick={() => selectDemo(id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {item.tabLabel}
              </button>
            );
          })}
        </div>

        <div className={styles.headActions}>
          <span
            className={`${styles.state} ${status === "error" && !staticMode ? styles.stateError : ""}`}
            role="status"
            aria-live="polite"
          >
            {stateLabel}
          </span>
          {webgl !== "unavailable" && status !== "loading" && !busy ? (
            <button
              type="button"
              className={styles.ghostButton}
              onClick={toggleTextMode}
              aria-pressed={textMode}
            >
              {textMode ? <CubeIcon /> : <TextIcon />}
              {textMode ? "3D view" : "Text view"}
            </button>
          ) : null}
        </div>
      </div>

      <div
        id={`${tabId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-${activeDemo}`}
        className={styles.viewport}
        tabIndex={-1}
        aria-busy={busy}
      >
        {!staticMode && webgl === "available" ? (
          <div className={styles.canvas} aria-hidden="true">
            <StageCanvas
              key={`${activeDemo}-${retryKey}`}
              demoId={activeDemo}
              assetUrl={demo.asset.path}
              viewCommand={viewCommand}
              playing={playing}
              speed={speed}
              seek={seek}
              reducedMotion={reducedMotion}
              onTime={handleTime}
              onEnded={handleEnded}
              onStatus={handleStatus}
            />
          </div>
        ) : null}

        {webgl === "checking" ? (
          <LoadingOverlay title="Checking 3D support" />
        ) : null}

        {!staticMode && webgl === "available" && status === "loading" ? (
          <LoadingOverlay title={`Loading ${demo.title}`} />
        ) : null}

        {!staticMode && webgl === "available" && status === "error" ? (
          <div className={styles.overlay} role="alert">
            <AlertIcon size={24} className={styles.overlayIcon} />
            <p className={styles.overlayTitle}>The {demo.title} model did not load.</p>
            <p className={styles.overlayCopy}>
              Retry the local file, or open a still frame and description.
            </p>
            <div className={styles.overlayActions}>
              <button type="button" className={styles.stageButton} onClick={retry}>
                Try again
              </button>
              <button
                type="button"
                className={styles.stageButton}
                onClick={() => setTextMode(true)}
              >
                Text view
              </button>
            </div>
          </div>
        ) : null}

        {staticMode ? (
          <div className={styles.fallback} role="region" aria-label="Static model view">
            <div className={styles.fallbackFigure}>
              <Image
                src={demo.fallback.image}
                alt={demo.fallback.alt}
                width={demo.fallback.width}
                height={demo.fallback.height}
                sizes="(max-width: 60rem) 92vw, 52vw"
                className={styles.fallbackImage}
                priority
              />
              <p className={styles.fallbackNote}>{demo.fallback.note}</p>
            </div>
            <div className={styles.fallbackCopy}>
              <p className={styles.fallbackNotice}>{fallbackNotice}</p>
              <p className={styles.fallbackTitle}>{demo.title}</p>
              <p className={styles.fallbackSummary}>{demo.summary}</p>
              {status === "error" && webgl === "available" ? (
                <button type="button" className={styles.stageButton} onClick={retry}>
                  Try 3D again
                </button>
              ) : null}
              <dl className={styles.fallbackStats}>
                {demo.stats.map((stat) => (
                  <div key={stat.label}>
                    <dt>{stat.label}</dt>
                    <dd>{stat.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        ) : null}
      </div>

      {staticMode ? (
        <div className={styles.foot}>
          <p className={styles.caption}>
            The still frame and model facts remain available. Use the stage tabs to switch
            demonstrations.
          </p>
        </div>
      ) : isMovement ? (
        <div className={styles.foot}>
          <div className={styles.transport}>
            <button
              type="button"
              className={`${styles.transportButton} ${styles.playButton}`}
              onClick={togglePlayback}
              disabled={!ready}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className={`${styles.transportButton} ${styles.replayButton}`}
              onClick={replay}
              disabled={!ready}
            >
              <ReplayIcon />
              Replay
            </button>
            <label className={styles.scrubWrap}>
              <span className="visually-hidden">Clip position</span>
              <input
                className={styles.scrub}
                type="range"
                min={0}
                max={duration}
                step={0.01}
                value={Math.min(time, duration)}
                onChange={(event) => scrub(Number(event.currentTarget.value))}
                disabled={!ready}
                aria-valuetext={`${formatSeconds(time)} of ${formatSeconds(duration)}`}
              />
            </label>
            <output className={styles.time} aria-live="off">
              {formatSeconds(time)}
              <span className={styles.timeDivider}>/</span>
              {formatSeconds(duration)}
            </output>
            <div className={styles.speed}>
              <label htmlFor={`${tabId}-speed`}>Speed</label>
              <span className={styles.selectWrap}>
                <select
                  id={`${tabId}-speed`}
                  className={styles.select}
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.currentTarget.value))}
                  disabled={!ready}
                >
                  {SPEEDS.map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
                <ChevronDownIcon className={styles.selectChevron} size={14} />
              </span>
            </div>
          </div>
          <p className={styles.caption}>
            Speed changes how the clip plays, not the exercise.
          </p>
        </div>
      ) : (
        <div className={styles.foot}>
          <div className={styles.anatomyControls}>
            <div className={styles.presets} role="group" aria-label="Camera view">
              <span className={styles.controlLabel}>View</span>
              <button
                type="button"
                className={styles.presetButton}
                onClick={() => issueView("front")}
                disabled={!ready}
              >
                Front
              </button>
              <button
                type="button"
                className={styles.presetButton}
                onClick={() => issueView("side")}
                disabled={!ready}
              >
                Side
              </button>
              <button
                type="button"
                className={styles.presetButton}
                onClick={() => issueView("back")}
                disabled={!ready}
              >
                Back
              </button>
            </div>
            <div className={styles.tools}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => issueView("zoom-out")}
                aria-label="Zoom out"
                title="Zoom out"
                disabled={!ready}
              >
                <MinusIcon />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => issueView("zoom-in")}
                aria-label="Zoom in"
                title="Zoom in"
                disabled={!ready}
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                className={styles.transportButton}
                onClick={() => issueView("reset")}
                disabled={!ready}
              >
                <ResetIcon />
                Reset view
              </button>
            </div>
          </div>
          <p className={styles.caption}>Drag to orbit. Scroll to zoom.</p>
        </div>
      )}
    </section>
  );
}

function LoadingOverlay({ title }: { title: string }) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <span className={styles.loader} aria-hidden="true">
        <span className={styles.loaderBar} />
      </span>
      <p className={styles.overlayTitle}>{title}</p>
      <p className={styles.overlayCopy}>Reading the local GLB file.</p>
    </div>
  );
}
