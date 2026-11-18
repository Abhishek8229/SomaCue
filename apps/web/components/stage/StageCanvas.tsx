"use client";

import { Component, memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import { CanvasTexture, Color, Mesh, PMREMGenerator, SRGBColorSpace, Vector3, type Object3D } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { loadModel } from "@/lib/load-model";
import { readStagePalette, type StagePalette } from "@/lib/stage-palette";
import { BODY_ASSET_URL } from "@/lib/kinematics/body-asset";
import { cameraFor, CAMERA_FOV_DEG } from "@/lib/kinematics/camera-presets";
import { MotionEngine } from "@/lib/kinematics/engine";
import type { MovementSpec } from "@/lib/kinematics/movement-spec";
import { POSTURE_DEFS } from "@/lib/kinematics/postures";
import { regionCapsule } from "@/lib/kinematics/regions";
import { createBodyRig } from "@/lib/kinematics/rig";
import { seatHeight } from "@/lib/kinematics/solver";
import type { Region } from "@/lib/kinematics/vocabulary";
import { AngleOverlay, type OverlayInsets } from "./angle-overlay";
import { createBodyMaterial, MAX_GLOWS, writeGlows, type GlowEntry } from "./body-material";
import type { StageGlow, StageHud, StageStatus, StageViewCommand } from "./stage-types";

export type StageCanvasProps = {
  spec: MovementSpec | null;
  /** changes whenever the same exercise should restart (Prev/Next, day change) */
  exerciseKey: string;
  playing: boolean;
  speed: number;
  stopped: boolean;
  view: StageViewCommand;
  glow: StageGlow;
  reducedMotion: boolean;
  /** guided pace waits at each step until it is released */
  guided: boolean;
  release: { id: number; step: string | null };
  onStatus: (status: StageStatus) => void;
  onHud: (hud: StageHud) => void;
  onFinished: () => void;
  /** joint angle protractors and pills (on by default) */
  showAngles?: boolean;
  /** space at the top and bottom of the stage kept clear of angle pills, in px */
  angleInsets?: OverlayInsets;
};

type LabelLayer = { layer: RefObject<HTMLDivElement | null>; svg: RefObject<SVGSVGElement | null> };

class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("The 3D stage stopped rendering.", error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function StudioEnvironment() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = generator.fromScene(room, 0.04).texture;
    // The three.js scene is an external mutable graph, not React state.
    // eslint-disable-next-line react-hooks/immutability
    scene.environment = texture;
    room.dispose();
    generator.dispose();
    return () => {
      scene.environment = null;
      texture.dispose();
    };
  }, [gl, scene]);
  return null;
}

const GLOW_COLORS = {
  active: new Color("#5eead4").multiplyScalar(0.3),
  pain: new Color("#f87171").multiplyScalar(0.8),
  flagged: new Color("#fbbf24").multiplyScalar(0.35),
};

type Props = Omit<StageCanvasProps, "onStatus"> & { template: Object3D; palette: StagePalette; labels: LabelLayer };

function StageScene({
  template,
  palette,
  spec,
  exerciseKey,
  playing,
  speed,
  stopped,
  view,
  glow,
  reducedMotion,
  guided,
  release,
  onHud,
  onFinished,
  showAngles = true,
  angleInsets,
  labels,
}: Props) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const matRef = useRef<Mesh>(null);

  const { engine, material, uniforms } = useMemo(() => {
    const rig = createBodyRig(cloneSkinned(template));
    const { material: bodyMaterial, uniforms: glowUniforms } = createBodyMaterial(palette.body, palette.accent);
    rig.mesh.material = bodyMaterial;
    rig.mesh.castShadow = false;
    seatHeight(rig);
    return { engine: new MotionEngine(rig), material: bodyMaterial, uniforms: glowUniforms };
  }, [template, palette]);

  useEffect(() => () => material.dispose(), [material]);

  const overlay = useMemo(
    () => new AngleOverlay({ accent: palette.accent, ink: palette.ink, muted: palette.muted }),
    [palette],
  );
  useEffect(() => {
    overlay.attach(labels.layer.current, labels.svg.current);
    return () => {
      overlay.attach(null, null);
      overlay.dispose();
    };
  }, [overlay, labels]);
  const showAnglesRef = useRef(showAngles);
  const insetsRef = useRef<OverlayInsets>(angleInsets ?? { top: 0, bottom: 0 });
  useEffect(() => {
    showAnglesRef.current = showAngles;
    insetsRef.current = angleInsets ?? { top: 0, bottom: 0 };
    invalidate();
  }, [showAngles, angleInsets, invalidate]);

  const posture = spec?.posture ?? "standing";
  const cameraGoal = useRef<{ position: Vector3; target: Vector3 } | null>(null);
  const userControl = useRef(false);
  const viewRef = useRef(view);
  const finishedRef = useRef(false);
  const hudClock = useRef(0);
  const lastWaitingRef = useRef<string | null>(null);
  const stoppedRef = useRef(stopped);
  const onHudRef = useRef(onHud);
  const onFinishedRef = useRef(onFinished);

  useEffect(() => {
    onHudRef.current = onHud;
    onFinishedRef.current = onFinished;
  }, [onHud, onFinished]);

  const frameCamera = (instant: boolean, known?: { center: Vector3; radius: number }) => {
    const bounds = known ?? engine.movementBounds();
    const goal = cameraFor(
      engine.currentSpec?.posture ?? "standing",
      viewRef.current.view,
      bounds.center,
      bounds.radius,
      size.width / Math.max(1, size.height),
    );
    cameraGoal.current = { position: goal.position, target: goal.target };
    userControl.current = false;
    if (instant || reducedMotion) {
      camera.position.copy(goal.position);
      controlsRef.current?.target.copy(goal.target);
      controlsRef.current?.update();
    }
    invalidate();
  };

  // A new exercise: rebuild the motion, frame the camera, restart the clock.
  useEffect(() => {
    viewRef.current = view;
    engine.setExercise(spec);
    finishedRef.current = false;
    const bounds = engine.movementBounds();
    // Lying bodies are not centred on the origin: keep the mat under the body.
    matRef.current?.position.set(bounds.center.x, 0.005, bounds.center.z);
    frameCamera(false, bounds);
    // frameCamera reads refs and the engine only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, spec, exerciseKey]);

  useEffect(() => {
    viewRef.current = view;
    frameCamera(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    stoppedRef.current = stopped;
    if (stopped) engine.stopToRest();
    else if (engine.isResting) engine.restart();
    invalidate();
  }, [engine, stopped, invalidate]);

  // The render loop is on demand: wake it whenever playback or the glow changes.
  useEffect(() => {
    invalidate();
  }, [playing, speed, glow, invalidate]);

  useEffect(() => {
    engine.setGuided(guided);
    invalidate();
  }, [engine, guided, invalidate]);

  useEffect(() => {
    if (release.step) engine.release(release.step);
    invalidate();
  }, [engine, release, invalidate]);

  // Frames on mount, and again whenever the stage changes size (a docked HUD on
  // narrow screens, a rotated phone), unless the user has moved the camera themselves.
  useEffect(() => {
    if (!userControl.current) frameCamera(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const frame = engine.update(delta, playing && !stopped, speed);

    // Region glow: pain in red, then the active exercise, then earlier flags.
    const entries: Array<{ region: Region; color: Color }> = [];
    const pulse = reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(state.clock.elapsedTime * 4);
    for (const region of glow.pain) entries.push({ region, color: GLOW_COLORS.pain.clone().multiplyScalar(pulse) });
    if (!stopped) {
      for (const region of frame.activeRegions) entries.push({ region, color: GLOW_COLORS.active });
    }
    for (const region of glow.flagged) entries.push({ region, color: GLOW_COLORS.flagged });
    const seen = new Set<Region>();
    const glows: GlowEntry[] = [];
    for (const entry of entries) {
      if (glows.length >= MAX_GLOWS || seen.has(entry.region)) continue;
      seen.add(entry.region);
      glows.push({ ...regionCapsule(engine.rig, entry.region), color: entry.color });
    }
    writeGlows(uniforms, glows);

    // Joint angles are read from the pose just solved, so they follow speed, pause and seeking.
    overlay.readBody(engine);
    overlay.update({
      engine,
      camera,
      size,
      enabled: showAnglesRef.current && !stopped,
      insets: insetsRef.current,
    });

    const goal = cameraGoal.current;
    const controls = controlsRef.current;
    if (goal && controls && !userControl.current) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 5);
      camera.position.lerp(goal.position, k);
      controls.target.lerp(goal.target, k);
      controls.update();
      if (camera.position.distanceTo(goal.position) < 0.002) cameraGoal.current = null;
    }

    hudClock.current += delta;
    const waitingChanged = frame.waitingStep !== lastWaitingRef.current;
    lastWaitingRef.current = frame.waitingStep;
    // The first done frame is always reported, so the last rep counts before playback ends.
    const reachedDone = Boolean(frame.sample?.done) && !finishedRef.current;
    if (frame.sample && (hudClock.current > 0.1 || waitingChanged || reachedDone)) {
      hudClock.current = 0;
      onHudRef.current({
        rep: frame.sample.rep,
        set: frame.sample.set,
        phase: frame.sample.phase,
        elapsed: frame.sample.elapsed,
        total: frame.sample.total,
        done: frame.sample.done,
        posture: frame.posture,
        phaseRemaining: frame.sample.phaseRemaining,
        mirrored: frame.sample.mirrored,
        stepKey: frame.sample.stepKey,
        waitingStep: frame.waitingStep,
        angles: stopped ? [] : overlay.summary,
      });
    }
    if (frame.sample?.done && !finishedRef.current) {
      finishedRef.current = true;
      onFinishedRef.current();
    }
    const moving = (playing && !stopped) || engine.isResting || glow.pain.length > 0 || cameraGoal.current !== null;
    if (moving) invalidate();
  });

  const def = POSTURE_DEFS[posture];
  const lying = def.lying || posture === "quadruped";

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, 6, 14]} />
      <StudioEnvironment />
      <hemisphereLight args={["#fff4e8", palette.bg, 0.22]} />
      {/* warm studio key, soft neutral fill and a faint emerald back rim */}
      <directionalLight position={[2.6, 4.8, 3.6]} intensity={1.6} color="#fff1e2" />
      <directionalLight position={[-3.6, 1.8, 2.2]} intensity={0.3} color={palette.ink2} />
      <directionalLight position={[-1.6, 2.6, -4.4]} intensity={0.55} color={palette.accent} />
      <directionalLight position={[2.4, 1.2, -3.2]} intensity={0.25} color={palette.accent} />

      <primitive object={engine.rig.root} />
      <primitive object={overlay.group} />

      <StageFloor palette={palette} />
      <Grid
        position={[0, 0.001, 0]}
        args={[20, 20]}
        cellSize={0.25}
        cellThickness={0.5}
        cellColor={palette.grid}
        sectionSize={1}
        sectionThickness={0.8}
        sectionColor={palette.gridStrong}
        fadeDistance={4.2}
        fadeStrength={2.4}
        fadeFrom={0}
        followCamera={false}
        infiniteGrid
      />
      {lying ? <Mat matRef={matRef} palette={palette} /> : null}
      {def.support === "seat" ? <Stool height={engine.rig.seatHeight} palette={palette} /> : null}
      <ContactShadows
        position={[0, 0.006, 0]}
        opacity={0.7}
        scale={5}
        blur={2.8}
        far={1.6}
        resolution={512}
        color={palette.shadow}
        frames={playing && !stopped ? Infinity : 1}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        enableDamping={!reducedMotion}
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={0.7}
        minDistance={1.2}
        maxDistance={9}
        onStart={() => {
          userControl.current = true;
          cameraGoal.current = null;
        }}
        onChange={() => invalidate()}
      />
    </>
  );
}

/**
 * Seamless floor: the far floor is exactly the background colour (unlit, no
 * fog), so there is no horizon line. A soft radial pool of light under the
 * figure fades out to it.
 */
function StageFloor({ palette }: { palette: StagePalette }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, palette.panel);
      gradient.addColorStop(0.45, palette.well);
      gradient.addColorStop(1, palette.bg);
      context.fillStyle = gradient;
      context.fillRect(0, 0, 256, 256);
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, [palette]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.004, 0]}>
        <planeGeometry args={[120, 120]} />
        <meshBasicMaterial color={palette.bg} fog={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, 0]}>
        <circleGeometry args={[4.5, 96]} />
        <meshBasicMaterial map={texture} fog={false} toneMapped={false} />
      </mesh>
    </>
  );
}

/**
 * Thin exercise mat for lying and hands-and-knees postures. Unlit, like the
 * floor, so it reads as a quiet dark panel instead of catching the key light.
 */
function Mat({ palette, matRef }: { palette: StagePalette; matRef: RefObject<Mesh | null> }) {
  return (
    <mesh position={[0, 0.005, -0.85]} ref={matRef}>
      <boxGeometry args={[0.9, 0.01, 2.05]} />
      <meshBasicMaterial color={palette.panel} fog={false} toneMapped={false} />
    </mesh>
  );
}

/**
 * Rounded architectural stool: a softly bevelled disc seat, one slim pedestal
 * and a low round foot, in the dark stage palette with a fine emerald edge.
 */
function Stool({ height, palette }: { height: number; palette: StagePalette }) {
  const top = Math.max(0.3, height - 0.004);
  const seatThickness = 0.05;
  const seatY = top - seatThickness / 2;
  const columnHeight = top - seatThickness - 0.03;
  return (
    <group position={[0, 0, -0.1]}>
      <mesh position={[0, seatY, 0]}>
        <cylinderGeometry args={[0.24, 0.225, seatThickness - 0.016, 64]} />
        <meshStandardMaterial color={palette.panel} roughness={0.55} metalness={0.1} envMapIntensity={0.4} />
      </mesh>
      <mesh position={[0, seatY + (seatThickness - 0.016) / 2, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.232, 0.008, 12, 64]} />
        <meshStandardMaterial color={palette.panel} roughness={0.5} metalness={0.1} envMapIntensity={0.4} />
      </mesh>
      <mesh position={[0, seatY - (seatThickness - 0.016) / 2, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.217, 0.008, 12, 64]} />
        <meshStandardMaterial
          color={palette.accent}
          emissive={palette.accent}
          emissiveIntensity={0.35}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0, 0.03 + columnHeight / 2, 0]}>
        <cylinderGeometry args={[0.032, 0.042, columnHeight, 32]} />
        <meshStandardMaterial color={palette.well} roughness={0.45} metalness={0.25} envMapIntensity={0.5} />
      </mesh>
      <mesh position={[0, 0.015, 0]}>
        <cylinderGeometry args={[0.17, 0.19, 0.03, 64]} />
        <meshStandardMaterial color={palette.panel} roughness={0.6} metalness={0.15} envMapIntensity={0.35} />
      </mesh>
    </group>
  );
}

function StageCanvas({ onStatus, ...props }: StageCanvasProps) {
  const [template, setTemplate] = useState<Object3D | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const labels = useMemo<LabelLayer>(() => ({ layer: layerRef, svg: svgRef }), []);
  const [palette] = useState<StagePalette>(() => readStagePalette());
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    onStatus("loading");
    loadModel(BODY_ASSET_URL)
      .then((gltf) => {
        if (!active) return;
        setTemplate(gltf.scene);
        onStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("The body model did not load.", error);
        onStatus("error");
      });
    return () => {
      active = false;
    };
  }, [onStatus]);

  return (
    <SceneBoundary onError={() => onStatus("error")}>
      <div className="relative h-full w-full">
      <Canvas
        camera={{ fov: CAMERA_FOV_DEG, near: 0.05, far: 60, position: [1, 1.4, 4] }}
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 0.95;
          gl.domElement.addEventListener(
            "webglcontextlost",
            (event) => {
              event.preventDefault();
              if (mountedRef.current) onStatus("error");
            },
            { once: true },
          );
        }}
      >
        {template ? (
          <StageScene template={template} palette={palette} labels={labels} {...props} />
        ) : (
          <color attach="background" args={[palette.bg]} />
        )}
      </Canvas>
      {/* Joint angle pills and their leader lines, positioned by the render loop. */}
      <svg
        aria-hidden="true"
        className="stage-angle-leaders pointer-events-none absolute inset-0 h-full w-full"
        data-hidden={props.showAngles === false || undefined}
        ref={svgRef}
      />
      <div
        aria-hidden="true"
        className="stage-angle-layer pointer-events-none absolute inset-0 overflow-hidden"
        data-hidden={props.showAngles === false || undefined}
        ref={layerRef}
      />
      </div>
    </SceneBoundary>
  );
}

export default memo(StageCanvas);
