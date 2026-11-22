"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { useThree } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import { CanvasTexture, PMREMGenerator, SRGBColorSpace, type Mesh } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { StagePalette } from "@/lib/stage-palette";

/**
 * Scenery shared by every 3D view of the body (the movement stage and the
 * landing hero preview), so both light and ground the figure the same way.
 */

export function StudioEnvironment() {
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

/** Floor grid that fades out around the figure. */
export function StageGrid({ palette }: { palette: StagePalette }) {
  return (
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
  );
}

/** Warm studio key, soft neutral fill and a faint emerald back rim. */
export function StudioLights({ palette }: { palette: StagePalette }) {
  return (
    <>
      <hemisphereLight args={["#fff4e8", palette.bg, 0.22]} />
      <directionalLight position={[2.6, 4.8, 3.6]} intensity={1.6} color="#fff1e2" />
      <directionalLight position={[-3.6, 1.8, 2.2]} intensity={0.3} color={palette.ink2} />
      <directionalLight position={[-1.6, 2.6, -4.4]} intensity={0.55} color={palette.accent} />
      <directionalLight position={[2.4, 1.2, -3.2]} intensity={0.25} color={palette.accent} />
    </>
  );
}

/**
 * Seamless floor: the far floor is exactly the background colour (unlit, no
 * fog), so there is no horizon line. A soft radial pool of light under the
 * figure fades out to it.
 */
export function StageFloor({ palette }: { palette: StagePalette }) {
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
export function Mat({ palette, matRef }: { palette: StagePalette; matRef: RefObject<Mesh | null> }) {
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
export function Stool({ height, palette }: { height: number; palette: StagePalette }) {
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
