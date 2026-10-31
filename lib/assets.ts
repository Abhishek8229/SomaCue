export type DemoId = "movement" | "anatomy";

export type Licence = {
  name: string;
  url: string;
  summary: string;
};

export type AssetFile = {
  path: string;
  bytes: number;
  format: "GLB";
};

export type Demo = {
  id: DemoId;
  tabLabel: string;
  title: string;
  metaLabel: string;
  summary: string;
  provenance: {
    sourceName: string;
    creator: string;
    sourceUrl: string;
    entryId: string;
    licence: Licence;
  };
  asset: AssetFile;
  fallback: {
    image: string;
    width: number;
    height: number;
    alt: string;
    note: string;
  };
  stats: Array<{ label: string; value: string }>;
};

export const MOVEMENT_STEPS = [
  "Bend your knees and rest your hands on your thighs, just above the knees.",
  "Round your back up and tuck your chin.",
  "Then push your chest forward and lift your gaze a little.",
  "If your knees hurt, bend them only slightly.",
] as const;

export const movement: Demo & {
  clip: { name: string; durationSeconds: number; channels: number; joints: number };
  sourceTrim: { originalClips: number; retainedClips: number; tool: string };
} = {
  id: "movement",
  tabLabel: "Movement",
  title: "Standing cat-cow",
  metaLabel: "Demonstration",
  summary: "Four steps from the source clip. The model starts paused.",
  provenance: {
    sourceName: "Desk Break",
    creator: "Shlomy Reshef",
    sourceUrl: "https://github.com/shlomorsh/desk-break",
    entryId: "standing-cat-cow",
    licence: {
      name: "MIT licence",
      url: "https://github.com/shlomorsh/desk-break/blob/main/LICENSE",
      summary:
        "Use, copy, modify, merge, publish, distribute, sublicense and sell, provided the copyright and permission notice travel with the files.",
    },
  },
  asset: {
    path: "/assets/movement/desk-break-standing-cat-cow.glb",
    bytes: 903_288,
    format: "GLB",
  },
  fallback: {
    image: "/assets/fallback/standing-cat-cow.png",
    width: 1200,
    height: 900,
    alt: "A still frame of the wooden standing cat-cow figure on the dark stage, viewed from the front left.",
    note: "The first frame of the rigged clip, captured from this prototype.",
  },
  clip: {
    name: "standing-cat-cow",
    durationSeconds: 2.833_333_253_860_473_6,
    channels: 48,
    joints: 16,
  },
  sourceTrim: {
    originalClips: 435,
    retainedClips: 1,
    tool: "glTF Transform 4.5.1",
  },
  stats: [
    { label: "Clip", value: "2.83\u00A0s" },
    { label: "Channels", value: "48" },
    { label: "Joints", value: "16" },
  ],
};

export const anatomy: Demo & {
  mesh: { triangles: number; vertices: number; name: string };
  version: { number: number; published: string };
} = {
  id: "anatomy",
  tabLabel: "Anatomy",
  title: "L4 vertebra",
  metaLabel: "Demonstration",
  summary: "One L4 vertebra from a surface scan, not the full lumbar series.",
  provenance: {
    sourceName: "NIH 3D",
    creator: "bgobbato",
    sourceUrl: "https://3d.nih.gov/entries/3DPX-000379",
    entryId: "3DPX-000379",
    licence: {
      name: "Public domain",
      url: "https://3d.nih.gov/entries/3DPX-000379",
      summary:
        "The NIH 3D record marks this entry Public Domain. It can be copied, modified and reused, including commercially, without a permission fee.",
    },
  },
  asset: {
    path: "/assets/anatomy/nih-3dpx-000379-l4.glb",
    bytes: 1_311_912,
    format: "GLB",
  },
  fallback: {
    image: "/assets/fallback/l4-vertebra.png",
    width: 1200,
    height: 900,
    alt: "A still frame of the L4 vertebra surface scan on the dark stage, viewed from the front left.",
    note: "The default camera view, captured from this prototype.",
  },
  mesh: {
    triangles: 16_805,
    vertices: 50_415,
    name: "col_lombar_apenas_l4",
  },
  version: { number: 3, published: "5 October 2026" },
  stats: [
    { label: "Triangles", value: "16,805" },
    { label: "Vertices", value: "50,415" },
    { label: "GLB", value: "1.25\u00A0MiB" },
  ],
};

export const DEMOS = {
  movement,
  anatomy,
};

export const DEMO_ORDER: DemoId[] = ["movement", "anatomy"];
