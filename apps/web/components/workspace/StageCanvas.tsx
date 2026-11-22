"use client";

import {
  Component,
  Suspense,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Grid, OrbitControls } from "@react-three/drei";
import {
  Box3,
  DoubleSide,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  Vector3,
  AnimationMixer,
  type AnimationAction,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DemoId } from "@/lib/assets";
import { loadModel } from "@/lib/load-model";
import { readStagePalette, type StagePalette } from "@/lib/stage-palette";
import type { ModelStatus, SeekCommand, ViewCommand } from "@/lib/stage-types";

type StageCanvasProps = {
  demoId: DemoId;
  assetUrl: string;
  viewCommand: ViewCommand;
  playing: boolean;
  speed: number;
  seek: SeekCommand;
  reducedMotion: boolean;
  onTime: (seconds: number) => void;
  onEnded: () => void;
  onStatus: (status: ModelStatus) => void;
};

type Vec3 = [number, number, number];

const VIEWS: Record<DemoId, { position: Vec3; target: Vec3 }> = {
  anatomy: { position: [2.9, 1.8, 3.9], target: [0, 0, 0] },
  movement: { position: [2.55, 1.5, 3.35], target: [0, 0.88, 0] },
};

const PRESETS: Record<"front" | "side" | "back", Vec3> = {
  front: [0, 0.5, 4.8],
  side: [4.8, 0.5, 0],
  back: [0, 0.5, -4.8],
};

class SceneBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("The 3D scene stopped rendering.", error);
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

function StageLights({ palette }: { palette: StagePalette }) {
  return (
    <>
      <ambientLight intensity={0.18} color={palette.ink2} />
      <directionalLight
        position={[3.8, 6.2, 4.5]}
        intensity={1.15}
        color={palette.ink}
      />
      <directionalLight
        position={[-4.5, 2.4, 1.8]}
        intensity={0.25}
        color={palette.accent}
      />
      <directionalLight
        position={[0.4, 2.8, -5.2]}
        intensity={0.45}
        color={palette.ink}
      />
    </>
  );
}

function StageFloor({
  palette,
  y,
  shadowFar,
  shadowOpacity,
}: {
  palette: StagePalette;
  y: number;
  shadowFar: number;
  shadowOpacity: number;
}) {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position={[0, y, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={palette.well} roughness={0.94} metalness={0} />
      </mesh>
      <Grid
        position={[0, y + 0.002, 0]}
        args={[20, 20]}
        cellSize={0.25}
        cellThickness={0.55}
        cellColor={palette.grid}
        sectionSize={1}
        sectionThickness={0.9}
        sectionColor={palette.gridStrong}
        fadeDistance={12}
        fadeStrength={1.1}
        followCamera={false}
        infiniteGrid
      />
      <ContactShadows
        position={[0, y + 0.004, 0]}
        opacity={shadowOpacity}
        scale={8}
        blur={2.4}
        far={shadowFar}
        resolution={256}
        color={palette.shadow}
      />
    </>
  );
}

function AnatomyModel({ gltf, palette }: { gltf: GLTF; palette: StagePalette }) {
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: palette.bone,
        roughness: 0.75,
        metalness: 0.02,
        side: DoubleSide,
        envMapIntensity: 0.2,
      }),
    [palette.bone],
  );

  const bounds = useMemo(() => {
    const box = new Box3().setFromObject(scene);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    return {
      center,
      scale: 2.1 / Math.max(size.x, size.y, size.z),
    };
  }, [scene]);

  useEffect(() => {
    scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.material = material;
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });

    return () => {
      material.dispose();
    };
  }, [scene, material]);

  return (
    <group scale={bounds.scale}>
      <group position={[-bounds.center.x, -bounds.center.y, -bounds.center.z]}>
        <primitive object={scene} />
      </group>
    </group>
  );
}

function MovementModel({
  gltf,
  playing,
  speed,
  seek,
  onTime,
  onEnded,
}: {
  gltf: GLTF;
  playing: boolean;
  speed: number;
  seek: SeekCommand;
  onTime: (seconds: number) => void;
  onEnded: () => void;
}) {
  const mixerRef = useRef<AnimationMixer | null>(null);
  const actionRef = useRef<AnimationAction | null>(null);
  const playingRef = useRef(playing);
  const onTimeRef = useRef(onTime);
  const onEndedRef = useRef(onEnded);
  const lastEmitRef = useRef(-1);
  const duration = gltf.animations[0]?.duration ?? 0;

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    onTimeRef.current = onTime;
    onEndedRef.current = onEnded;
  }, [onTime, onEnded]);

  useEffect(() => {
    const clip = gltf.animations[0];
    if (!clip) return;

    const mixer = new AnimationMixer(gltf.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveTimeScale(speed);
    action.play();
    action.paused = true;

    mixerRef.current = mixer;
    actionRef.current = action;

    const handleFinished = () => onEndedRef.current();
    mixer.addEventListener("finished", handleFinished);
    mixer.update(0);
    onTimeRef.current(0);

    return () => {
      mixer.removeEventListener("finished", handleFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      mixerRef.current = null;
      actionRef.current = null;
    };
    // The mixer is rebuilt only when the GLB changes. Playback state is
    // synchronised by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf]);

  useEffect(() => {
    const action = actionRef.current;
    if (!action) return;
    action.paused = !playing;
    if (playing) {
      action.enabled = true;
      action.play();
    }
  }, [playing]);

  useEffect(() => {
    actionRef.current?.setEffectiveTimeScale(speed);
  }, [speed]);

  useEffect(() => {
    const action = actionRef.current;
    const mixer = mixerRef.current;
    if (!action || !mixer || seek.id === 0) return;
    action.time = Math.min(Math.max(seek.seconds, 0), duration);
    mixer.update(0);
    onTimeRef.current(action.time);
  }, [seek, duration]);

  useFrame((_, delta) => {
    if (!playingRef.current) return;
    const mixer = mixerRef.current;
    const action = actionRef.current;
    if (!mixer || !action) return;

    mixer.update(Math.min(delta, 0.05));
    const now = action.time;
    if (now - lastEmitRef.current > 0.06 || now >= duration - 0.004) {
      lastEmitRef.current = now;
      onTimeRef.current(now);
    }
  });

  return (
    <>
      <primitive object={gltf.scene} />
    </>
  );
}

function CameraRig({
  demoId,
  command,
  reducedMotion,
}: {
  demoId: DemoId;
  command: ViewCommand;
  reducedMotion: boolean;
}) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const view = VIEWS[demoId];
    const place = (position: Vec3, target: Vec3) => {
      controls.target.set(target[0], target[1], target[2]);
      camera.position.set(position[0], position[1], position[2]);
      controls.update();
    };

    if (command.type === "reset") {
      place(view.position, view.target);
    } else if (
      command.type === "front" ||
      command.type === "side" ||
      command.type === "back"
    ) {
      place(PRESETS[command.type], demoId === "anatomy" ? [0, 0, 0] : view.target);
    } else {
      const offset = camera.position.clone().sub(controls.target);
      const factor = command.type === "zoom-in" ? 0.82 : 1.22;
      const next = Math.min(
        Math.max(offset.length() * factor, controls.minDistance),
        controls.maxDistance,
      );
      camera.position.copy(controls.target).add(offset.setLength(next));
      controls.update();
    }
  }, [camera, command, demoId]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      rotateSpeed={0.62}
      zoomSpeed={0.75}
      minDistance={2.1}
      maxDistance={8}
    />
  );
}

function StageScene({
  demoId,
  gltf,
  palette,
  viewCommand,
  playing,
  speed,
  seek,
  reducedMotion,
  onTime,
  onEnded,
}: {
  demoId: DemoId;
  gltf: GLTF;
  palette: StagePalette;
  viewCommand: ViewCommand;
  playing: boolean;
  speed: number;
  seek: SeekCommand;
  reducedMotion: boolean;
  onTime: (seconds: number) => void;
  onEnded: () => void;
}) {
  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.bg, 10, 20]} />
      <StudioEnvironment />
      <StageLights palette={palette} />
      {demoId === "anatomy" ? (
        <AnatomyModel gltf={gltf} palette={palette} />
      ) : (
        <MovementModel
          gltf={gltf}
          playing={playing}
          speed={speed}
          seek={seek}
          onTime={onTime}
          onEnded={onEnded}
        />
      )}
      <StageFloor
        palette={palette}
        y={demoId === "anatomy" ? -1.55 : -0.02}
        shadowFar={demoId === "anatomy" ? 4.5 : 3}
        shadowOpacity={demoId === "anatomy" ? 0.42 : 0.5}
      />
      <CameraRig demoId={demoId} command={viewCommand} reducedMotion={reducedMotion} />
    </>
  );
}

function StageCanvas({
  demoId,
  assetUrl,
  viewCommand,
  playing,
  speed,
  seek,
  reducedMotion,
  onTime,
  onEnded,
  onStatus,
}: StageCanvasProps) {
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const palette = useState<StagePalette>(() => readStagePalette())[0];
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    onStatus("loading");

    loadModel(assetUrl)
      .then((model) => {
        if (!active) return;
        if (demoId === "movement" && model.animations.length === 0) {
          throw new Error("The movement file has no animation clip.");
        }
        setGltf(model);
        onStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("The stage model did not load.", error);
        onStatus("error");
      });

    return () => {
      active = false;
    };
  }, [assetUrl, demoId, onStatus]);

  return (
    <SceneBoundary onError={() => onStatus("error")}>
      <Canvas
        camera={{
          fov: 32,
          near: 0.1,
          far: 60,
          position: VIEWS[demoId].position,
        }}
        dpr={[1, 1.75]}
        frameloop="always"
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = 0.9;
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
        <Suspense fallback={null}>
          {gltf ? (
            <StageScene
              demoId={demoId}
              gltf={gltf}
              palette={palette}
              viewCommand={viewCommand}
              playing={playing}
              speed={speed}
              seek={seek}
              reducedMotion={reducedMotion}
              onTime={onTime}
              onEnded={onEnded}
            />
          ) : (
            <>
              <color attach="background" args={[palette.bg]} />
              <StageLights palette={palette} />
              <StageFloor
                palette={palette}
                y={demoId === "anatomy" ? -1.55 : -0.02}
                shadowFar={demoId === "anatomy" ? 4.5 : 3}
                shadowOpacity={demoId === "anatomy" ? 0.42 : 0.5}
              />
            </>
          )}
        </Suspense>
      </Canvas>
    </SceneBoundary>
  );
}

export default memo(StageCanvas);
