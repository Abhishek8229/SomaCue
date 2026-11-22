"use client";

import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import type { Mesh, Object3D } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AngleOverlay, type OverlayInsets } from "@/components/stage/angle-overlay";
import { createGlowUniforms, dressBody, GLOW_COLORS, MAX_GLOWS, writeGlows } from "@/components/stage/body-material";
import { loadBodyTemplate } from "@/components/stage/body-template";
import { SceneBoundary } from "@/components/stage/scene-boundary";
import { Mat, StageFloor, StageGrid, StudioEnvironment, StudioLights } from "@/components/stage/stage-scenery";
import { cameraFor, CAMERA_FOV_DEG, defaultView } from "@/lib/kinematics/camera-presets";
import { MotionEngine } from "@/lib/kinematics/engine";
import { normalizeSpec, type MovementSpec } from "@/lib/kinematics/movement-spec";
import { findReferenceExercise } from "@/lib/kinematics/reference-exercises";
import { regionCapsule } from "@/lib/kinematics/regions";
import { createBodyRig } from "@/lib/kinematics/rig";
import { poseAt, prepareMovement, safeProgress, solvePose } from "@/lib/kinematics/solver";
import { minimumJerk } from "@/lib/kinematics/timeline";
import { readStagePalette, type StagePalette } from "@/lib/stage-palette";

/**
 * The live 3D figure inside the landing hero's faux Rehab Studio window: the
 * same CC4 athlete, rig mapping, materials, lighting and solver as the movement
 * stage, posed for the Supine Pelvic Tilt. The hero script owns the timing, so
 * the figure eases between the start pose (0) and the held tilt (1) on the
 * engine's own minimum-jerk curve and stays in step with the card's captions.
 */
export type HeroFigureProps = {
  /** 0: lying at rest, 1: pelvis tilted and held */
  pose: 0 | 1;
  /** how long a move between the two poses takes */
  transitionMs: number;
  reducedMotion: boolean;
  onReady: () => void;
  onError: () => void;
};

const TILT_SPEC: MovementSpec = (() => {
  const reference = findReferenceExercise("Supine Pelvic Tilt");
  if (!reference) throw new Error("The Supine Pelvic Tilt reference exercise is missing.");
  return normalizeSpec(reference.spec).spec;
})();

/** Wider than this, the card frames the figure tighter (camera distance times the zoom). */
const WIDE_CARD_ASPECT = 1.4;
const WIDE_CARD_ZOOM = 0.8;
/** Keep angle pills below the card's Move / Hold caption, which overlaps the top of the figure area. */
const PILL_INSETS: OverlayInsets = { top: 34, bottom: 4 };

type LabelLayer = { layer: RefObject<HTMLDivElement | null>; svg: RefObject<SVGSVGElement | null> };

type SceneProps = Omit<HeroFigureProps, "onError"> & {
  template: Object3D;
  palette: StagePalette;
  hostRef: RefObject<HTMLDivElement | null>;
  labels: LabelLayer;
  /** the card is on screen; off screen nothing renders */
  visible: boolean;
};

function HeroScene({ template, palette, pose, transitionMs, reducedMotion, onReady, hostRef, labels, visible }: SceneProps) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const matRef = useRef<Mesh>(null);

  const figure = useMemo(() => {
    const rig = createBodyRig(cloneSkinned(template));
    const uniforms = createGlowUniforms(palette.accent);
    const materials = dressBody(rig.model, palette.body, uniforms);
    // The engine frames the whole rep once and finds the joints that move, exactly as the movement stage does.
    const engine = new MotionEngine(rig);
    engine.setExercise(TILT_SPEC);
    const bounds = engine.movementBounds();
    return {
      rig,
      engine,
      uniforms,
      materials,
      bounds,
      setup: prepareMovement(rig, TILT_SPEC, false),
      safe: safeProgress(rig, TILT_SPEC, false),
    };
  }, [template, palette]);
  useEffect(() => () => figure.materials.forEach((material) => material.dispose()), [figure]);

  // Live joint-angle arcs and pills, the same overlay the movement stage draws.
  const overlay = useMemo(
    () => new AngleOverlay({ accent: palette.accent, ink: palette.ink, muted: palette.muted }),
    [palette],
  );
  useEffect(() => {
    overlay.attach(labels.layer.current, labels.svg.current);
    invalidate();
    return () => {
      overlay.attach(null, null);
      overlay.dispose();
    };
  }, [overlay, labels, invalidate]);

  useEffect(() => {
    matRef.current?.position.set(figure.bounds.center.x, 0.005, figure.bounds.center.z);
    const posture = TILT_SPEC.posture;
    const aspect = size.width / Math.max(1, size.height);
    const goal = cameraFor(posture, defaultView(posture), figure.bounds.center, figure.bounds.radius, aspect);
    // Same side view as the movement stage. A wide card frames the body tighter so a
    // 10 degree tilt reads at hero size; a narrow one keeps the full-body fit.
    const zoom = aspect >= WIDE_CARD_ASPECT ? WIDE_CARD_ZOOM : 1;
    camera.position.copy(goal.target).addScaledVector(goal.position.clone().sub(goal.target), zoom);
    camera.lookAt(goal.target);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, figure, size.width, size.height, invalidate]);

  // A new target pose starts a move from wherever the figure is now. Off-screen the
  // figure just takes the new pose, so the hidden hero never renders frames.
  const motion = useRef({ from: pose as number, to: pose as number, t: 1 });
  useEffect(() => {
    const current = motion.current;
    const now = current.from + (current.to - current.from) * minimumJerk(current.t);
    motion.current = { from: now, to: pose, t: reducedMotion || !visible ? 1 : 0 };
    if (visible) invalidate();
  }, [pose, reducedMotion, visible, invalidate]);

  const reported = useRef(false);
  useFrame((_, rawDelta) => {
    const current = motion.current;
    if (current.t < 1) current.t = Math.min(1, current.t + Math.min(rawDelta, 0.05) / Math.max(0.05, transitionMs / 1000));
    const progress = current.from + (current.to - current.from) * minimumJerk(current.t);
    solvePose(figure.rig, TILT_SPEC.posture, poseAt(TILT_SPEC, progress * figure.safe, false), figure.setup);
    writeGlows(
      figure.uniforms,
      TILT_SPEC.targetRegions.slice(0, MAX_GLOWS).map((region) => ({ ...regionCapsule(figure.rig, region), color: GLOW_COLORS.active })),
    );
    // Angles are read from the pose solved this frame, so they follow the hero's pace and holds.
    overlay.readBody(figure.engine);
    overlay.update({ engine: figure.engine, camera, size, enabled: true, insets: PILL_INSETS });
    const host = hostRef.current;
    if (host) {
      host.dataset.pose = String(current.to);
      host.dataset.settled = String(current.t >= 1);
    }
    if (current.t < 1 && visible) invalidate();
    if (!reported.current) {
      reported.current = true;
      onReady();
    }
  });

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, 6, 14]} />
      <StudioEnvironment />
      <StudioLights palette={palette} />
      <primitive object={figure.rig.root} />
      <primitive object={overlay.group} />
      <StageFloor palette={palette} />
      <StageGrid palette={palette} />
      <Mat matRef={matRef} palette={palette} />
      <ContactShadows position={[0, 0.006, 0]} opacity={0.7} scale={5} blur={2.8} far={1.6} resolution={256} color={palette.shadow} />
    </>
  );
}

function HeroFigure({ pose, transitionMs, reducedMotion, onReady, onError }: HeroFigureProps) {
  const [template, setTemplate] = useState<Object3D | null>(null);
  const [palette] = useState<StagePalette>(() => readStagePalette());
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const labels = useMemo<LabelLayer>(() => ({ layer: layerRef, svg: svgRef }), []);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let active = true;
    loadBodyTemplate()
      .then((scene) => {
        if (active) setTemplate(scene);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("The hero body model did not load.", error);
        onErrorRef.current();
      });
    return () => {
      active = false;
    };
  }, []);

  // The hero window is drawn scaled (down on small screens, up to 2x on large
  // ones), so the drawing buffer follows the on-screen size, not the layout size.
  const [dpr, setDpr] = useState(1);
  // Render only while the card is on screen: the page scrolls on to the main stage.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const drawn = host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1;
      setDpr(Math.min(2, Math.max(1, (window.devicePixelRatio || 1) * drawn)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div className="relative h-full w-full" ref={hostRef}>
      <SceneBoundary onError={() => onErrorRef.current()}>
        <Canvas
          camera={{ fov: CAMERA_FOV_DEG, near: 0.05, far: 60, position: [1, 1.4, 4] }}
          dpr={dpr}
          frameloop="demand"
          // Measure the layout size: the hero window is CSS-scaled, and the
          // scaled size would be scaled a second time.
          resize={{ offsetSize: true }}
          gl={{ antialias: true, alpha: false, powerPreference: "low-power", preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 0.95;
            gl.domElement.addEventListener(
              "webglcontextlost",
              (event) => {
                event.preventDefault();
                onErrorRef.current();
              },
              { once: true },
            );
          }}
        >
          {template ? (
            <HeroScene
              hostRef={hostRef}
              labels={labels}
              onReady={onReady}
              palette={palette}
              pose={pose}
              reducedMotion={reducedMotion}
              template={template}
              transitionMs={transitionMs}
              visible={visible}
            />
          ) : (
            <color attach="background" args={[palette.bg]} />
          )}
        </Canvas>
        {/* Joint angle pills and their leader lines, positioned by the render loop. */}
        <svg aria-hidden="true" className="stage-angle-leaders pointer-events-none absolute inset-0 h-full w-full" ref={svgRef} />
        <div aria-hidden="true" className="stage-angle-layer pointer-events-none absolute inset-0 overflow-hidden" ref={layerRef} />
      </SceneBoundary>
    </div>
  );
}

export default memo(HeroFigure);
