"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { readStagePalette } from "@/lib/stage-palette";
import type { LabScene } from "@/lib/lab/lab-runtime";

export type LabView = "front" | "side" | "back" | "torso" | "reset";
export type LabViewCommand = { id: number; view: LabView };

const VIEWS: Record<LabView, { position: [number, number, number]; target: [number, number, number] }> = {
  reset: { position: [2.6, 1.5, 4.2], target: [0, 0.9, 0] },
  front: { position: [0, 1.0, 5.0], target: [0, 0.9, 0] },
  side: { position: [5.0, 1.0, 0], target: [0, 0.9, 0] },
  back: { position: [0, 1.0, -5.0], target: [0, 0.9, 0] },
  torso: { position: [0, 1.25, 2.3], target: [0, 1.2, 0] },
};

function Driver({ lab, onTime }: { lab: LabScene; onTime: (seconds: number) => void }) {
  const since = useRef(0);
  useFrame((_, delta) => {
    lab.update(delta);
    since.current += delta;
    if (since.current > 0.1) {
      since.current = 0;
      onTime(lab.time());
    }
  });
  return null;
}

function CameraRig({ command }: { command: LabViewCommand }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    const ctrl = controls.current;
    if (!ctrl) return;
    const view = VIEWS[command.view];
    ctrl.target.set(...view.target);
    camera.position.set(...view.position);
    ctrl.update();
  }, [camera, command]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableDamping
      dampingFactor={0.08}
      minDistance={0.4}
      maxDistance={12}
    />
  );
}

function LabStage({
  lab,
  command,
  onTime,
}: {
  lab: LabScene | null;
  command: LabViewCommand;
  onTime: (seconds: number) => void;
}) {
  const [palette] = useState(() => readStagePalette());
  return (
    <Canvas
      camera={{ fov: 32, near: 0.05, far: 60, position: VIEWS.reset.position }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    >
      <color attach="background" args={[palette.bg]} />
      <hemisphereLight args={["#ffffff", "#5a6468", 1.1]} />
      <directionalLight position={[3.5, 5, 4]} intensity={2.2} />
      <directionalLight position={[-4, 2.5, -3]} intensity={0.9} color={palette.accent} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.002, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color={palette.well} roughness={0.95} />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        args={[20, 20]}
        cellSize={0.25}
        cellThickness={0.55}
        cellColor={palette.grid}
        sectionSize={1}
        sectionThickness={0.9}
        sectionColor={palette.gridStrong}
        fadeDistance={12}
        followCamera={false}
        infiniteGrid
      />
      {lab ? (
        <>
          <primitive object={lab.root} />
          <Driver lab={lab} onTime={onTime} />
        </>
      ) : null}
      <CameraRig command={command} />
    </Canvas>
  );
}

export default memo(LabStage);
