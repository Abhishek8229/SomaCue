export type Vec3 = [number, number, number];

export type RegionId = "torso" | "head" | "arm.L" | "arm.R" | "leg.L" | "leg.R";

export type LandmarkRow = {
  id: string;
  label: string;
  atlas: Vec3;
  rig: Vec3;
  errorMm: number;
};

export type SegmentRow = {
  id: string;
  label: string;
  atlasM: number;
  rigM: number;
  /** atlas length divided by rig length, before any fitting */
  ratio: number;
};

export type AxisRow = {
  id: string;
  label: string;
  atlas: Vec3;
  rig: Vec3;
  agreeDeg: number;
};

export type RegionContainment = {
  region: RegionId;
  samples: number;
  insidePct: number;
};

export type PoseSample = {
  label: string;
  timeS: number;
  skeletalInsidePct: number;
  softInsidePct: number;
  regions: RegionContainment[];
  /** share of sampled soft-tissue edges stretched or compressed by more than 25% against rest */
  softEdgesOver25Pct: number;
  maxEdgeStretch: number;
  /** lowest point of the rig skin; negative means below the floor */
  lowestSkinYmm: number;
};

export type CheckRow = {
  id: string;
  group: "scale" | "orientation" | "alignment" | "movement" | "licence";
  label: string;
  criterion: string;
  value: string;
  pass: boolean;
};

export type LabResults = {
  generatedAt: string;
  durationMs: { load: number; build: number; analysis: number };
  atlas: {
    parts: number;
    vertices: number;
    triangles: number;
    heightM: number;
    skeletonHeightM: number;
    bounds: { min: Vec3; max: Vec3 };
  };
  rig: {
    bones: number;
    vertices: number;
    triangles: number;
    heightM: number;
    nativeBounds: { min: Vec3; max: Vec3 };
  };
  scale: {
    heightRatioAtlasOverRig: number;
    fittedScale: number;
    atlasSkinHeightM: number;
    rigSkinHeightM: number;
  };
  orientation: {
    axes: AxisRow[];
    residualDeg: { yaw: number; pitch: number; roll: number };
  };
  alignment: {
    fitScale: number;
    fitTranslation: Vec3;
    landmarks: LandmarkRow[];
    segments: SegmentRow[];
    rmsMm: number;
    maxMm: number;
    matchedPose: {
      armAbductionBeforeDeg: number;
      armAbductionAfterDeg: number;
      atlasArmAbductionDeg: number;
    };
  };
  skinning: {
    meshes: number;
    softVertices: number;
    rigidParts: number;
    unmappedBones: string[];
  };
  rest: PoseSample;
  motion: {
    clip: string;
    durationS: number;
    sourceChannels: number;
    mappedBones: number;
    requiredBones: number;
    missingBones: string[];
    bakedFrames: number;
    samples: PoseSample[];
    worstSkeletalInsidePct: number;
    worstSoftEdgesOver25Pct: number;
    finite: boolean;
  };
  checks: CheckRow[];
  verdict: {
    usableTogether: boolean;
    summary: string;
    passed: number;
    failed: number;
  };
};

export type LabStatus =
  | { phase: "idle" }
  | { phase: "loading"; label: string; progress: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export type PoseMode = "matched" | "native" | "clip";
export type SkinMode = "solid" | "ghost" | "off";
