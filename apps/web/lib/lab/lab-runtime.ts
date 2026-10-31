import {
  AnimationAction,
  AnimationMixer,
  DoubleSide,
  Group,
  LoopRepeat,
  Vector3,
} from "three";
import {
  ATLAS_SYSTEMS,
  loadAtlas,
  partBounds,
  requirePart,
  type AtlasData,
  type AtlasSystemId,
} from "./atlas-loader";
import {
  atlasLandmarks,
  fitUniform,
  landmarkRows,
  matchLimbsToAtlas,
  orientationAxes,
  residualRotation,
  rigLandmarks,
  segmentRows,
} from "./lab-landmarks";
import { PoseAnalyzer } from "./lab-metrics";
import { retargetClip } from "./lab-retarget";
import { loadRig, restoreLocals, snapshotLocals } from "./lab-rig";
import {
  buildAtlasMeshes,
  buildSegments,
  DEFAULT_SYSTEMS,
  type AtlasBuild,
} from "./lab-skinning";
import type {
  CheckRow,
  LabResults,
  LabStatus,
  PoseMode,
  PoseSample,
  SkinMode,
  Vec3,
} from "./lab-types";

/** Pass criteria. They are fixed here, before any measurement is read. */
export const CRITERIA = {
  heightTolerance: 0.05,
  axisDeg: 10,
  residualDeg: 5,
  segmentTolerance: 0.05,
  landmarkRmsMm: 15,
  landmarkMaxMm: 30,
  restSkeletalInsidePct: 95,
  restRegionInsidePct: 90,
  clipSkeletalInsidePct: 90,
  clipSoftEdgesPct: 3,
} as const;

export type LabScene = {
  root: Group;
  results: LabResults;
  duration: number;
  setRigVisible: (visible: boolean) => void;
  setSkinMode: (mode: SkinMode) => void;
  setAtlasVisible: (visible: boolean) => void;
  setSystemVisible: (system: AtlasSystemId, visible: boolean) => void;
  systemVisible: (system: AtlasSystemId) => boolean;
  setPose: (mode: PoseMode) => void;
  setPlaying: (playing: boolean) => void;
  seek: (seconds: number) => void;
  setSpeed: (speed: number) => void;
  time: () => number;
  update: (delta: number) => void;
  dispose: () => void;
};

const mm = (v: number) => `${v.toFixed(1)} mm`;
const pct = (v: number) => `${v.toFixed(1)}%`;
const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];

function evaluateChecks(r: Omit<LabResults, "checks" | "verdict">): CheckRow[] {
  const c = CRITERIA;
  const checks: CheckRow[] = [];
  const add = (row: CheckRow) => checks.push(row);

  const heightDelta = Math.abs(r.scale.heightRatioAtlasOverRig - 1);
  add({
    id: "scale.height",
    basis: "assets",
    group: "scale",
    label: "Overall height matches",
    criterion: `Atlas skin height within ${c.heightTolerance * 100}% of rig skin height`,
    value: `${r.scale.atlasSkinHeightM.toFixed(3)} m vs ${r.scale.rigSkinHeightM.toFixed(3)} m (${(
      (r.scale.heightRatioAtlasOverRig - 1) *
      100
    ).toFixed(1)}%)`,
    pass: heightDelta <= c.heightTolerance,
  });

  const worstAxis = Math.max(...r.orientation.axes.map((a) => a.agreeDeg));
  add({
    id: "orientation.axes",
    basis: "assets",
    group: "orientation",
    label: "Up, front and left axes agree",
    criterion: `Each axis within ${c.axisDeg}° (both files: Y up, +Z front, +X subject left)`,
    value: `worst ${worstAxis.toFixed(1)}°`,
    pass: worstAxis <= c.axisDeg,
  });
  const worstResidual = Math.max(
    Math.abs(r.orientation.residualDeg.yaw),
    Math.abs(r.orientation.residualDeg.pitch),
    Math.abs(r.orientation.residualDeg.roll),
  );
  add({
    id: "orientation.residual",
    basis: "assets",
    group: "orientation",
    label: "No re-orientation needed",
    criterion: `Residual rotation of the landmark clouds within ${c.residualDeg}°`,
    value: `yaw ${r.orientation.residualDeg.yaw.toFixed(1)}°, pitch ${r.orientation.residualDeg.pitch.toFixed(
      1,
    )}°, roll ${r.orientation.residualDeg.roll.toFixed(1)}°`,
    pass: worstResidual <= c.residualDeg,
  });

  const limbs = r.alignment.segments.filter((s) => /\.(L|R)$/.test(s.id));
  const scaled = limbs.map((s) => ({
    s,
    ratio: s.ratio * r.alignment.fitScale,
  }));
  const worst = scaled.reduce((a, b) =>
    Math.abs(b.ratio - 1) > Math.abs(a.ratio - 1) ? b : a,
  );
  const offenders = scaled.filter(
    (e) => Math.abs(e.ratio - 1) > c.segmentTolerance,
  ).length;
  add({
    id: "alignment.proportions",
    basis: "assets",
    group: "alignment",
    label: "Limb segments have the same proportions",
    criterion: `Every limb segment within ${c.segmentTolerance * 100}% of its counterpart after uniform scaling`,
    value: `${offenders} of ${scaled.length} outside; worst ${worst.s.label} at ${(
      (worst.ratio - 1) *
      100
    ).toFixed(0)}%`,
    pass: offenders === 0,
  });

  add({
    id: "alignment.landmarks",
    basis: "assets",
    group: "alignment",
    label: "Joints coincide after the best uniform fit",
    criterion: `RMS ≤ ${c.landmarkRmsMm} mm and worst ≤ ${c.landmarkMaxMm} mm over ${r.alignment.landmarks.length} landmarks`,
    value: `RMS ${mm(r.alignment.rmsMm)}, worst ${mm(r.alignment.maxMm)}`,
    pass:
      r.alignment.rmsMm <= c.landmarkRmsMm &&
      r.alignment.maxMm <= c.landmarkMaxMm,
  });

  add({
    id: "method.containment",
    basis: "method",
    group: "alignment",
    label: "Containment test is valid",
    criterion: `On the rig's own surface, points 5 mm inside read inside (≥ 95%) and points 5 mm outside read outside (≤ 5%)`,
    value: `${pct(r.validation.inwardInsidePct)} inside, ${pct(r.validation.outwardInsidePct)} outside, ${r.validation.samples} points`,
    pass:
      r.validation.inwardInsidePct >= 95 && r.validation.outwardInsidePct <= 5,
  });

  const weakestRegion = r.rest.regions
    .filter((reg) => reg.samples > 0)
    .reduce((a, b) => (b.insidePct < a.insidePct ? b : a));
  add({
    id: "alignment.containment",
    basis: "assets",
    group: "alignment",
    label: "Skeleton sits inside the rig skin at rest",
    criterion: `≥ ${c.restSkeletalInsidePct}% overall and ≥ ${c.restRegionInsidePct}% in every region`,
    value: `${pct(r.rest.skeletalInsidePct)} overall; weakest ${weakestRegion.region} ${pct(weakestRegion.insidePct)}`,
    pass:
      r.rest.skeletalInsidePct >= c.restSkeletalInsidePct &&
      weakestRegion.insidePct >= c.restRegionInsidePct,
  });

  add({
    id: "movement.retarget",
    basis: "method",
    group: "movement",
    label: "Clip retargets to the rig",
    criterion: "All mapped bones found and every baked value finite",
    value: `${r.motion.mappedBones} of ${r.motion.requiredBones} bones; ${r.motion.bakedFrames} frames${
      r.motion.missingBones.length
        ? `; missing ${r.motion.missingBones.join(", ")}`
        : ""
    }`,
    pass: r.motion.mappedBones === r.motion.requiredBones && r.motion.finite,
  });
  add({
    id: "movement.containment",
    basis: "method",
    group: "movement",
    label: "Skeleton stays inside the skin during the clip",
    criterion: `Worst sampled frame ≥ ${c.clipSkeletalInsidePct}% inside`,
    value: `worst ${pct(r.motion.worstSkeletalInsidePct)}`,
    pass: r.motion.worstSkeletalInsidePct >= c.clipSkeletalInsidePct,
  });
  add({
    id: "movement.softTissue",
    basis: "method",
    group: "movement",
    label: "Soft structures deform without tearing",
    criterion: `≤ ${c.clipSoftEdgesPct}% of sampled edges stretched or squashed by more than 25%. Depends on the lab's generated skin weights as much as on the assets. A missing measurement cannot pass.`,
    value:
      r.motion.worstSoftEdgesOver25Pct === undefined
        ? "Not measured"
        : `worst ${pct(r.motion.worstSoftEdgesOver25Pct)}`,
    pass:
      r.motion.worstSoftEdgesOver25Pct !== undefined &&
      r.motion.worstSoftEdgesOver25Pct <= c.clipSoftEdgesPct,
  });

  add({
    id: "licence.register",
    basis: "assets",
    group: "licence",
    label: "All three sources have a verified licence",
    criterion:
      "Source, licence, revision and attribution recorded (docs/3d-lab/asset-register.md)",
    value: "CC BY 4.0 (atlas), CC0 (rig), CC0 (clip)",
    pass: true,
  });
  return checks;
}

function summarise(checks: CheckRow[]): LabResults["verdict"] {
  const failed = checks.filter((check) => !check.pass);
  const assetFailures = failed.filter((check) => check.basis === "assets");
  const methodFailures = failed.filter((check) => check.basis === "method");
  const usable = failed.length === 0;
  const names = (rows: CheckRow[]) => rows.map((row) => row.label).join("; ");
  let summary = "Every criterion passed. The assets can be combined as tested.";
  if (!usable) {
    summary = `Not compatible as tested.`;
    if (assetFailures.length) summary += ` Asset-level failures: ${names(assetFailures)}.`;
    if (methodFailures.length) {
      summary += ` Method-level failures (depend on the lab's own skin weights): ${names(methodFailures)}.`;
    }
  }
  return {
    usableTogether: usable,
    passed: checks.length - failed.length,
    failed: failed.length,
    assetFailures: assetFailures.length,
    methodFailures: methodFailures.length,
    summary,
  };
}

export async function createLabScene(
  onStatus: (status: LabStatus) => void,
  signal?: AbortSignal,
): Promise<LabScene> {
  const t0 = performance.now();
  onStatus({ phase: "loading", label: "Loading Innerscene rig", progress: 0 });
  const rig = await loadRig();

  onStatus({ phase: "loading", label: "Loading Human Atlas", progress: 0 });
  const atlas: AtlasData = await loadAtlas(
    (fraction) =>
      onStatus({
        phase: "loading",
        label: "Loading Human Atlas",
        progress: fraction,
      }),
    signal,
  );
  const tLoaded = performance.now();

  // 1. Native-pose measurements (orientation and proportions do not depend on pose).
  const atlasPts = atlasLandmarks(atlas);
  const nativePts = rigLandmarks(rig);
  const axes = orientationAxes(atlasPts, nativePts);
  const segments = segmentRows(atlasPts, nativePts);

  // 2. Retarget while the rig is still in its native pose.
  onStatus({ phase: "loading", label: "Retargeting animation", progress: 0 });
  const retarget = await retargetClip(rig);

  // 3. Pose the limbs to match the atlas, then fit scale and translation.
  const matched = matchLimbsToAtlas(rig, atlasPts);
  const matchedPts = rigLandmarks(rig);
  const fit = fitUniform(atlasPts, matchedPts);
  const rows = landmarkRows(atlasPts, matchedPts, fit);
  const rms = Math.sqrt(
    rows.reduce((sum, row) => sum + row.errorMm ** 2, 0) / rows.length,
  );
  const maxErr = Math.max(...rows.map((row) => row.errorMm));
  const residual = residualRotation(atlasPts, matchedPts);
  const matchedLocals = snapshotLocals(rig.skeleton.bones);

  // 4. Skin the atlas to the rig.
  const skinSegments = buildSegments(rig);
  const build: AtlasBuild = await buildAtlasMeshes(
    atlas,
    fit,
    rig,
    skinSegments,
    (fraction) =>
      onStatus({
        phase: "loading",
        label: "Skinning anatomy to the skeleton",
        progress: fraction,
      }),
  );
  const tBuilt = performance.now();

  const nativeBox = (() => {
    const pos = rig.body.geometry.attributes.position.array;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], pos[i + a]);
        max[a] = Math.max(max[a], pos[i + a]);
      }
    }
    return { min, max };
  })();
  const rigHeight = nativeBox.max[1] - nativeBox.min[1];
  const skinPart = requirePart(atlas, "Skin");
  const atlasSkinHeight = skinPart.bounds[1][1] - skinPart.bounds[0][1];

  // 5. Measure rest, native A-pose and the clip.
  onStatus({ phase: "loading", label: "Measuring alignment", progress: 0 });
  const analyzer = new PoseAnalyzer(rig, build);
  const rest = analyzer.analyze("Rest (matched pose)", 0);

  // Sensitivity: is the result an artefact of the joint-fit scale? Rebuild with a height-matched scale.
  const heightScale = rigHeight / atlasSkinHeight;
  const hipMid = (set: Map<string, Vector3>) =>
    set.get("hip.L")!.clone().add(set.get("hip.R")!).multiplyScalar(0.5);
  const heightFit = {
    scale: heightScale,
    translation: hipMid(matchedPts).sub(hipMid(atlasPts).multiplyScalar(heightScale)),
  };
  const altBuild = await buildAtlasMeshes(atlas, heightFit, rig, skinSegments, () => {});
  const altSample = new PoseAnalyzer(rig, altBuild, 3000, 0, 0).analyze("Height-matched fit", 0);
  altBuild.dispose();

  restoreLocals(rig, rig.nativeRest);
  const nativeSample = analyzer.analyze("Native A-pose", 0);
  const selfTest = analyzer.selfTest(0.005);
  restoreLocals(rig, matchedLocals);

  const mixer = new AnimationMixer(rig.scene);
  const action: AnimationAction = mixer.clipAction(retarget.clip);
  action.setLoop(LoopRepeat, Infinity);
  const duration = retarget.durationS;
  const fractions = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const clipSamples: PoseSample[] = [];
  action.reset().play();
  action.paused = true;
  for (const fraction of fractions) {
    action.time = fraction * duration;
    mixer.update(0);
    clipSamples.push(
      analyzer.analyze(
        `Clip ${Math.round(fraction * 100)}%`,
        fraction * duration,
      ),
    );
  }
  action.stop();
  mixer.update(0);
  rig.scene.updateMatrixWorld(true);

  const atlasAll = partBounds(atlas.parts);
  const atlasSkeleton = partBounds(
    atlas.parts.filter((p) => p.system === "skeletal"),
  );

  const allSamples = [...clipSamples];
  const measuredSoftEdges = allSamples
    .map((s) => s.softEdgesOver25Pct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const worstSoftEdgesOver25Pct = measuredSoftEdges.length
    ? Math.max(...measuredSoftEdges)
    : undefined;
  const partial: Omit<LabResults, "checks" | "verdict"> = {
    generatedAt: new Date().toISOString(),
    durationMs: {
      load: tLoaded - t0,
      build: tBuilt - tLoaded,
      analysis: performance.now() - tBuilt,
    },
    atlas: {
      parts: atlas.parts.length,
      vertices: atlas.vertices,
      triangles: atlas.triangles,
      heightM: atlasAll.max[1] - atlasAll.min[1],
      skeletonHeightM: atlasSkeleton.max[1] - atlasSkeleton.min[1],
      bounds: atlasAll,
    },
    rig: {
      bones: rig.skeleton.bones.length,
      vertices: rig.body.geometry.attributes.position.count,
      triangles: (rig.body.geometry.index?.count ?? 0) / 3,
      heightM: rigHeight,
      nativeBounds: nativeBox,
    },
    scale: {
      heightRatioAtlasOverRig: atlasSkinHeight / rigHeight,
      fittedScale: fit.scale,
      atlasSkinHeightM: atlasSkinHeight,
      rigSkinHeightM: rigHeight,
    },
    orientation: { axes, residualDeg: residual },
    alignment: {
      fitScale: fit.scale,
      fitTranslation: toVec3(fit.translation),
      landmarks: rows,
      segments,
      rmsMm: rms,
      maxMm: maxErr,
      matchedPose: {
        armAbductionBeforeDeg: matched.before,
        armAbductionAfterDeg: matched.after,
        atlasArmAbductionDeg: matched.atlasDeg,
      },
    },
    skinning: {
      meshes: build.meshes.size,
      softVertices: build.stats.softVertices,
      rigidParts: build.stats.rigidParts,
      unmappedBones: retarget.missing,
    },
    rest,
    heightMatchedFit: { ...altSample, scale: heightScale },
    validation: { offsetMm: 5, ...selfTest },
    motion: {
      clip: retarget.clip.name,
      durationS: duration,
      sourceChannels: retarget.sourceChannels,
      mappedBones: retarget.mappedBones,
      requiredBones: retarget.requiredBones,
      missingBones: retarget.missing,
      bakedFrames: retarget.frames,
      samples: [nativeSample, ...allSamples],
      worstSkeletalInsidePct: Math.min(
        ...allSamples.map((s) => s.skeletalInsidePct),
      ),
      ...(worstSoftEdgesOver25Pct === undefined
        ? {}
        : { worstSoftEdgesOver25Pct }),
      finite: retarget.finite,
    },
  };
  const checks = evaluateChecks(partial);
  const results: LabResults = {
    ...partial,
    checks,
    verdict: summarise(checks),
  };

  // 6. Assemble the scene.
  const root = new Group();
  root.name = "lab-root";
  root.add(rig.scene);
  const atlasGroup = new Group();
  atlasGroup.name = "atlas-group";
  for (const mesh of build.meshes.values()) atlasGroup.add(mesh);
  root.add(atlasGroup);

  let skinMode: SkinMode = "solid";
  let rigVisible = true;
  const applySkin = () => {
    rig.body.visible = rigVisible && skinMode !== "off";
    for (const mesh of rig.skinMeshes) mesh.visible = rig.body.visible;
    rig.bodyMaterial.transparent = skinMode === "ghost";
    rig.bodyMaterial.opacity = skinMode === "ghost" ? 0.22 : 1;
    rig.bodyMaterial.depthWrite = skinMode !== "ghost";
    rig.bodyMaterial.side = DoubleSide;
    rig.bodyMaterial.needsUpdate = true;
  };
  applySkin();

  let pose: PoseMode = "matched";
  let playing = false;
  const startClip = () => {
    action.reset();
    action.play();
  };
  const applyPose = (mode: PoseMode) => {
    pose = mode;
    if (mode === "clip") {
      startClip();
      action.paused = !playing;
      return;
    }
    action.stop();
    mixer.update(0);
    restoreLocals(rig, mode === "native" ? rig.nativeRest : matchedLocals);
  };

  return {
    root,
    results,
    duration,
    setRigVisible: (visible) => {
      rigVisible = visible;
      applySkin();
    },
    setSkinMode: (mode) => {
      skinMode = mode;
      applySkin();
    },
    setAtlasVisible: (visible) => {
      atlasGroup.visible = visible;
    },
    setSystemVisible: (system, visible) => {
      const mesh = build.meshes.get(system);
      if (mesh) mesh.visible = visible;
    },
    systemVisible: (system) => build.meshes.get(system)?.visible ?? false,
    setPose: applyPose,
    setPlaying: (value) => {
      playing = value;
      // Only entering playback should force the clip pose. Stopping must not
      // switch the scene back to the clip after a different pose was chosen.
      if (value && pose !== "clip") applyPose("clip");
      action.paused = !playing;
    },
    seek: (seconds) => {
      if (pose !== "clip") applyPose("clip");
      action.paused = true;
      playing = false;
      action.time = Math.min(Math.max(seconds, 0), duration);
      mixer.update(0);
    },
    setSpeed: (value) => {
      action.setEffectiveTimeScale(value);
    },
    time: () => {
      if (pose !== "clip") return 0;
      // Clamp at the endpoint: modulo would turn a scrub to the clip duration
      // into 0.00, which looks like a reset.
      return Math.min(Math.max(action.time, 0), duration);
    },
    update: (delta) => {
      // The playback speed lives on the action's time scale.
      if (pose === "clip" && playing) mixer.update(Math.min(delta, 0.05));
    },
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.scene);
      build.dispose();
      rig.bodyMaterial.dispose();
      rig.body.geometry.dispose();
    },
  };
}

export { ATLAS_SYSTEMS, DEFAULT_SYSTEMS };
