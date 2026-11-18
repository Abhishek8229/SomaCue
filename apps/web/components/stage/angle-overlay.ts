import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Camera,
  type InterleavedBufferAttribute,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  labelDegrees,
  summarizeAngles,
  type AngleLabel,
  type AngleReading,
  type AngleSummaryItem,
  type AngleTrack,
} from "@/lib/kinematics/angles";
import type { MotionEngine } from "@/lib/kinematics/engine";
import type { RigJoint } from "@/lib/kinematics/rig";
import { layoutLabels, type LabelRequest, type Point } from "./angle-layout";

/*
 * Draws a protractor at every moving joint (start arm, live arm, shaded
 * sector, the rep's range and 5° ticks) and keeps a degree pill beside each
 * one. Everything is redrawn from the live reading each frame; nothing here
 * animates on its own. Imperative on purpose: it runs inside the render loop.
 */

const ARC_POINTS = 33;
const MAX_TICKS = 37;
const ARC_SHARE = 0.72;
const COMPACT_BELOW_PX = 560;
const LAYER = 20;

export type OverlayColors = { accent: string; ink: string; muted: string };
export type OverlayInsets = { top: number; bottom: number };

type JointVisual = {
  group: Group;
  ref: Line2;
  live: Line2;
  track: Line2;
  edge: Line2;
  ticks: LineSegments2;
  sector: Mesh;
  dot: Mesh;
};

type Pill = {
  label: AngleLabel;
  root: HTMLDivElement;
  name: HTMLSpanElement;
  degrees: HTMLSpanElement;
  leader: SVGLineElement;
  width: number;
  height: number;
  shown: number;
};

function makeLine(points: number, material: LineMaterial) {
  const geometry = new LineGeometry();
  geometry.setPositions(new Float32Array(points * 3));
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = LAYER + 2;
  return line;
}

/** Rewrites a polyline's points in place (LineGeometry stores each segment's two ends). */
function writeLine(line: Line2, points: Float32Array) {
  const attribute = line.geometry.attributes.instanceStart as InterleavedBufferAttribute;
  const data = attribute.data;
  const array = data.array as Float32Array;
  const segments = points.length / 3 - 1;
  for (let i = 0; i < segments; i++) array.set(points.subarray(i * 3, i * 3 + 6), i * 6);
  data.needsUpdate = true;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const tmpQuat = new Quaternion();

/** Points along an arc from `from`, turning about `normal` by `degrees`. */
function arcPoints(out: Float32Array, center: Vector3, from: Vector3, normal: Vector3, degrees: number, radius: number) {
  const step = (degrees * Math.PI) / 180 / (ARC_POINTS - 1);
  const dir = new Vector3();
  for (let i = 0; i < ARC_POINTS; i++) {
    tmpQuat.setFromAxisAngle(normal, step * i);
    dir.copy(from).applyQuaternion(tmpQuat).multiplyScalar(radius).add(center);
    out[i * 3] = dir.x;
    out[i * 3 + 1] = dir.y;
    out[i * 3 + 2] = dir.z;
  }
  return out;
}

/** Joints and mid-bone points used to keep the pills off the figure. */
const BODY_POINTS: Array<RigJoint | [RigJoint, RigJoint]> = [
  "pelvis", "spine1", "spine2", "spine3", "neck", "head",
  "thighL", "calfL", "footL", "ballL", "thighR", "calfR", "footR", "ballR",
  "upperarmL", "lowerarmL", "handL", "upperarmR", "lowerarmR", "handR",
  ["thighL", "calfL"], ["calfL", "footL"], ["thighR", "calfR"], ["calfR", "footR"],
  ["upperarmL", "lowerarmL"], ["lowerarmL", "handL"], ["upperarmR", "lowerarmR"], ["lowerarmR", "handR"],
  ["pelvis", "spine2"], ["spine2", "neck"],
];

export class AngleOverlay {
  readonly group = new Group();
  /** what the stage readout shows; updated every frame */
  summary: AngleSummaryItem[] = [];

  private readonly materials: {
    ref: LineMaterial;
    live: LineMaterial;
    track: LineMaterial;
    edge: LineMaterial;
    ticks: LineMaterial;
    sector: MeshBasicMaterial;
    dot: MeshBasicMaterial;
  };
  private readonly dotGeometry = new SphereGeometry(0.009, 12, 8);
  private readonly sectorIndex: number[] = [];
  private visuals = new Map<string, JointVisual>();
  private pills = new Map<string, Pill>();
  private version = -1;
  private layer: HTMLDivElement | null = null;
  private svg: SVGSVGElement | null = null;
  private compact: boolean | null = null;
  private slots = new Map<string, number>();
  private readonly arc = new Float32Array(ARC_POINTS * 3);
  private readonly pair = new Float32Array(6);

  constructor(colors: OverlayColors) {
    const line = (color: string, linewidth: number, opacity: number) =>
      new LineMaterial({
        color: new Color(color),
        linewidth,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
    this.materials = {
      ref: line(colors.ink, 1.6, 0.6),
      live: line(colors.accent, 2.6, 1),
      track: line(colors.accent, 1.2, 0.32),
      edge: line(colors.accent, 2, 0.95),
      ticks: line(colors.ink, 1.2, 0.45),
      sector: new MeshBasicMaterial({
        color: new Color(colors.accent),
        transparent: true,
        opacity: 0.24,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
      dot: new MeshBasicMaterial({ color: new Color(colors.accent), depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
    };
    // Fan triangles from the pivot to each arc point.
    for (let i = 1; i < ARC_POINTS; i++) this.sectorIndex.push(0, i, i + 1);
    this.group.name = "JointAngleOverlay";
  }

  /** The DOM layer for the pills and the SVG for their leader lines. */
  attach(layer: HTMLDivElement | null, svg: SVGSVGElement | null) {
    if (layer === this.layer && svg === this.svg) return;
    this.clearPills();
    this.layer = layer;
    this.svg = svg;
    this.version = -1;
  }

  private buildVisual(): JointVisual {
    const group = new Group();
    const sectorGeometry = new BufferGeometry();
    sectorGeometry.setAttribute("position", new BufferAttribute(new Float32Array((ARC_POINTS + 1) * 3), 3));
    sectorGeometry.setIndex(this.sectorIndex);
    const sector = new Mesh(sectorGeometry, this.materials.sector);
    sector.frustumCulled = false;
    sector.renderOrder = LAYER;
    const ticksGeometry = new LineSegmentsGeometry();
    ticksGeometry.setPositions(new Float32Array(MAX_TICKS * 6));
    const ticks = new LineSegments2(ticksGeometry, this.materials.ticks);
    ticks.frustumCulled = false;
    ticks.renderOrder = LAYER + 1;
    const dot = new Mesh(this.dotGeometry, this.materials.dot);
    dot.renderOrder = LAYER + 3;
    const visual: JointVisual = {
      group,
      ref: makeLine(2, this.materials.ref),
      live: makeLine(2, this.materials.live),
      track: makeLine(ARC_POINTS, this.materials.track),
      edge: makeLine(ARC_POINTS, this.materials.edge),
      ticks,
      sector,
      dot,
    };
    group.add(sector, visual.track, ticks, visual.edge, visual.ref, visual.live, dot);
    return visual;
  }

  private disposeVisual(visual: JointVisual) {
    visual.ref.geometry.dispose();
    visual.live.geometry.dispose();
    visual.track.geometry.dispose();
    visual.edge.geometry.dispose();
    visual.ticks.geometry.dispose();
    visual.sector.geometry.dispose();
    this.group.remove(visual.group);
  }

  private clearPills() {
    for (const pill of this.pills.values()) {
      pill.root.remove();
      pill.leader.remove();
    }
    this.pills.clear();
    this.slots.clear();
  }

  /** Rebuild protractors and pills for every joint either side of the exercise uses. */
  private rebuild(tracks: [AngleTrack, AngleTrack] | null) {
    for (const visual of this.visuals.values()) this.disposeVisual(visual);
    this.visuals.clear();
    this.clearPills();
    if (!tracks) return;
    const labels = new Map<string, AngleLabel>();
    for (const track of tracks) {
      for (const joint of track.joints) {
        if (this.visuals.has(joint.id)) continue;
        const visual = this.buildVisual();
        this.visuals.set(joint.id, visual);
        this.group.add(visual.group);
      }
      for (const label of track.labels) labels.set(`${label.key}|${label.name}|${label.side}`, label);
    }
    if (!this.layer || !this.svg) return;
    for (const [id, label] of labels) {
      const root = document.createElement("div");
      root.className = "stage-angle-pill";
      const side = document.createElement("span");
      side.className = "stage-angle-side";
      side.textContent = label.side ?? "";
      if (!label.side) side.hidden = true;
      const name = document.createElement("span");
      name.className = "stage-angle-name";
      const sep = document.createElement("span");
      sep.className = "stage-angle-sep";
      sep.textContent = "·";
      const degrees = document.createElement("span");
      degrees.className = "stage-angle-deg";
      degrees.textContent = "0°";
      root.append(side, name, sep, degrees);
      root.style.visibility = "hidden";
      this.layer.append(root);
      const leader = document.createElementNS(SVG_NS, "line");
      leader.setAttribute("class", "stage-angle-leader");
      leader.style.visibility = "hidden";
      this.svg.append(leader);
      this.pills.set(id, { label, root, name, degrees, leader, width: 0, height: 0, shown: -1 });
    }
    this.compact = null;
  }

  private setCompact(compact: boolean) {
    if (this.compact === compact) return;
    this.compact = compact;
    for (const pill of this.pills.values()) {
      pill.name.textContent = compact ? pill.label.short : pill.label.name;
      pill.root.dataset.compact = compact ? "true" : "false";
      // The degree slot has a fixed width, so the pill keeps this size as the number changes.
      pill.width = pill.root.offsetWidth;
      pill.height = pill.root.offsetHeight;
    }
  }

  private hideAll() {
    for (const visual of this.visuals.values()) visual.group.visible = false;
    for (const pill of this.pills.values()) {
      pill.root.style.visibility = "hidden";
      pill.leader.style.visibility = "hidden";
    }
  }

  update(options: {
    engine: MotionEngine;
    camera: Camera;
    size: { width: number; height: number };
    enabled: boolean;
    insets: OverlayInsets;
  }) {
    const { engine, camera, size, enabled, insets } = options;
    if (engine.angleTrackVersion !== this.version) {
      this.version = engine.angleTrackVersion;
      this.rebuild(engine.angleTracks);
    }
    const track = engine.angleTrack;
    if (!track) {
      this.summary = [];
      this.hideAll();
      return;
    }
    const readings = engine.measureAngles();
    this.summary = summarizeAngles(track, readings);
    if (!enabled) {
      this.hideAll();
      return;
    }

    const resolution = { x: size.width, y: size.height };
    for (const material of [this.materials.ref, this.materials.live, this.materials.track, this.materials.edge, this.materials.ticks]) {
      material.resolution.set(resolution.x, resolution.y);
    }

    const byId = new Map(readings.map((reading) => [reading.id, reading]));
    for (const [id, visual] of this.visuals) {
      const reading = byId.get(id);
      visual.group.visible = Boolean(reading);
      if (reading) this.drawJoint(visual, reading);
    }
    this.placePills(track, readings, camera, size, insets);
  }

  private drawJoint(visual: JointVisual, reading: AngleReading) {
    const { pivot, ref, live, normal, ray } = reading;
    const radius = ray * ARC_SHARE;

    this.pair.set([pivot.x, pivot.y, pivot.z, pivot.x + ref.x * ray, pivot.y + ref.y * ray, pivot.z + ref.z * ray]);
    writeLine(visual.ref, this.pair);
    this.pair.set([pivot.x, pivot.y, pivot.z, pivot.x + live.x * ray, pivot.y + live.y * ray, pivot.z + live.z * ray]);
    writeLine(visual.live, this.pair);

    // The rep's full range, faint, and the part covered so far, filled.
    writeLine(visual.track, arcPoints(this.arc, pivot, ref, normal, reading.peakDegrees, radius));
    arcPoints(this.arc, pivot, ref, normal, reading.signedDegrees, radius);
    writeLine(visual.edge, this.arc);
    const sector = visual.sector.geometry.attributes.position as BufferAttribute;
    const positions = sector.array as Float32Array;
    positions.set([pivot.x, pivot.y, pivot.z], 0);
    positions.set(this.arc, 3);
    sector.needsUpdate = true;

    // Protractor ticks every 5°, longer every 15°, along the rep's range.
    const ticks = visual.ticks.geometry as LineSegmentsGeometry;
    const tickData = (ticks.attributes.instanceStart as InterleavedBufferAttribute).data;
    const tickArray = tickData.array as Float32Array;
    const count = Math.min(MAX_TICKS, Math.floor(reading.peakDegrees / 5) + 1);
    const dir = new Vector3();
    for (let i = 0; i < count; i++) {
      tmpQuat.setFromAxisAngle(normal, (i * 5 * Math.PI) / 180);
      dir.copy(ref).applyQuaternion(tmpQuat);
      const long = i % 3 === 0;
      const inner = radius * (long ? 0.86 : 0.92);
      const outer = radius * (long ? 1.14 : 1.08);
      tickArray.set(
        [
          pivot.x + dir.x * inner, pivot.y + dir.y * inner, pivot.z + dir.z * inner,
          pivot.x + dir.x * outer, pivot.y + dir.y * outer, pivot.z + dir.z * outer,
        ],
        i * 6,
      );
    }
    ticks.instanceCount = count;
    tickData.needsUpdate = true;

    visual.dot.position.copy(pivot);
  }

  private project(point: Vector3, camera: Camera, size: { width: number; height: number }): Point | null {
    const v = point.clone().project(camera);
    if (v.z < -1 || v.z > 1) return null;
    return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
  }

  private placePills(
    track: AngleTrack,
    readings: AngleReading[],
    camera: Camera,
    size: { width: number; height: number },
    insets: OverlayInsets,
  ) {
    this.setCompact(size.width < COMPACT_BELOW_PX);
    const byId = new Map(readings.map((reading) => [reading.id, reading]));
    const active = new Set<string>();
    const requests: LabelRequest[] = [];
    const obstacles: Point[] = [];

    // The figure and the protractors themselves are kept clear of pills.
    for (const reading of readings) {
      const projected = this.project(reading.pivot, camera, size);
      if (projected) obstacles.push(projected);
      const radius = reading.ray * ARC_SHARE;
      for (const share of [0.5, 1]) {
        tmpQuat.setFromAxisAngle(reading.normal, (reading.peakDegrees * share * Math.PI) / 180);
        const tip = reading.ref.clone().applyQuaternion(tmpQuat).multiplyScalar(radius).add(reading.pivot);
        const point = this.project(tip, camera, size);
        if (point) obstacles.push(point);
      }
    }
    for (const point of this.bodyPoints) {
      const projected = this.project(point, camera, size);
      if (projected) obstacles.push(projected);
    }

    for (const [id, pill] of this.pills) {
      if (!track.labels.includes(pill.label)) continue;
      const members = pill.label.joints.map((joint) => byId.get(joint)).filter(Boolean) as AngleReading[];
      if (!members.length) continue;
      // Anchor just outside the middle of the rep's arc.
      const anchors = members
        .map((reading) => {
          tmpQuat.setFromAxisAngle(reading.normal, (reading.peakDegrees * 0.5 * Math.PI) / 180);
          const mid = reading.ref.clone().applyQuaternion(tmpQuat).multiplyScalar(reading.ray * 0.9).add(reading.pivot);
          return this.project(mid, camera, size);
        })
        .filter(Boolean) as Point[];
      if (!anchors.length) continue;
      const anchor = {
        x: anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length,
        y: anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length,
      };
      active.add(id);
      requests.push({ key: id, width: pill.width, height: pill.height, anchor, priority: pill.label.peakDegrees });

      const value = Math.round(labelDegrees(pill.label, readings));
      if (value !== pill.shown) {
        pill.shown = value;
        pill.degrees.textContent = `${value}°`;
      }
    }

    const placements = layoutLabels(
      requests,
      { left: 8, top: insets.top + 8, right: size.width - 8, bottom: size.height - insets.bottom },
      obstacles,
      this.slots,
    );
    const placed = new Map(placements.map((placement) => [placement.key, placement]));
    for (const [id, pill] of this.pills) {
      const placement = placed.get(id);
      if (!active.has(id) || !placement?.visible) {
        pill.root.style.visibility = "hidden";
        pill.leader.style.visibility = "hidden";
        continue;
      }
      this.slots.set(id, placement.slot);
      pill.root.style.visibility = "visible";
      pill.root.style.transform = `translate(${Math.round(placement.x)}px, ${Math.round(placement.y)}px)`;
      if (placement.leader) {
        pill.leader.setAttribute("x1", placement.leader.x1.toFixed(1));
        pill.leader.setAttribute("y1", placement.leader.y1.toFixed(1));
        pill.leader.setAttribute("x2", placement.leader.x2.toFixed(1));
        pill.leader.setAttribute("y2", placement.leader.y2.toFixed(1));
        pill.leader.style.visibility = "visible";
      } else {
        pill.leader.style.visibility = "hidden";
      }
    }
  }

  private bodyPoints: Vector3[] = [];

  /** Body points for keeping pills off the figure, read from the rig once per frame. */
  readBody(engine: MotionEngine) {
    const bones = engine.rig.bones;
    this.bodyPoints = BODY_POINTS.map((entry) =>
      Array.isArray(entry)
        ? bones[entry[0]].getWorldPosition(new Vector3()).add(bones[entry[1]].getWorldPosition(new Vector3())).multiplyScalar(0.5)
        : bones[entry].getWorldPosition(new Vector3()),
    );
  }

  dispose() {
    for (const visual of this.visuals.values()) this.disposeVisual(visual);
    this.visuals.clear();
    this.clearPills();
    this.dotGeometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
  }
}
