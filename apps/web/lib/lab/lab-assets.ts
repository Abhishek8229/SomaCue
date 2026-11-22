/**
 * Asset register for the /3d-lab compatibility experiment (Stage 5).
 *
 * Everything the lab serves is listed here with its source, licence and the
 * exact modifications made. The full written register is
 * docs/3d-lab/asset-register.md; keep the two in step.
 *
 * Nothing here is a clinical asset. The three files are used only to test
 * whether an anatomical dataset, a rigged body and a motion clip can be
 * combined.
 */

export type LabLicence = {
  name: string;
  url: string;
  attribution: string;
  attributionRequired: boolean;
};

export type LabAssetFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type LabAsset = {
  id: "atlas" | "innerscene" | "animation";
  title: string;
  role: string;
  creator: string;
  sourceUrl: string;
  sourceRevision: string;
  retrieved: string;
  licence: LabLicence;
  files: LabAssetFile[];
  modifications: string[];
  caveats: string[];
};

const RETRIEVED = "31 October 2026";

export const ATLAS_BASE_PATH = "/assets/lab/human-atlas/";
export const RIG_PATH = "/assets/lab/innerscene/male-base-mesh-base_male.glb";
export const MOTION_PATH = "/assets/lab/mesh2motion/mesh2motion-jumping-jacks.glb";
export const MOTION_CLIP_NAME = "Jumping Jacks";

export const LAB_ASSETS: LabAsset[] = [
  {
    id: "atlas",
    title: "Human Atlas, adult male reference body",
    role: "Full-body anatomy: 2,234 named structures in 15 systems",
    creator:
      "Data: BodyParts3D, The Database Center for Life Science. Viewer data packaging: Human Atlas (slorksmo/Human-Atlas).",
    sourceUrl: "https://github.com/slorksmo/Human-Atlas",
    sourceRevision: "main @ 5bb5713aab18d7fe9380c3339eb09f173491ea06 (6 Sep 2026)",
    retrieved: RETRIEVED,
    licence: {
      name: "CC BY 4.0 (anatomy data); MIT (viewer code, not used)",
      url: "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
      attribution:
        "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.",
      attributionRequired: true,
    },
    files: [
      {
        path: `${ATLAS_BASE_PATH}atlas.json`,
        bytes: 1_335_285,
        sha256: "d6979fc62cf18fa4f08a9e6efae8fdac9ec383c5a1f3c757920125ac758429fe",
      },
      {
        path: `${ATLAS_BASE_PATH}body-0.bin.gz … body-14.bin.gz`,
        bytes: 33_466_685,
        sha256: "per-file hashes in docs/3d-lab/asset-register.md",
      },
    ],
    modifications: [
      "The geometry is used exactly as packaged by Human Atlas: axes converted to metres, Y-up; meshes simplified with meshoptimizer at a 0.2% error bound; packed into binary chunks.",
      "In the lab only, vertices are scaled and translated into the rig's space and skinned to the rig. The source files are not edited.",
      "No female data, no Arabic vocabulary and none of the viewer's code is shipped or reused.",
    ],
    caveats: [
      "The Human Atlas ATTRIBUTION.md notes that the source OBJ files carry an older CC BY-SA 2.1 Japan comment; the current DBCLS licence page (updated 2025-02-27) states CC BY 4.0 and supersedes it. Legal review should confirm before production use.",
      "BodyParts3D is a reference anatomy built from one adult male dataset and illustration refinements. It is not a patient model.",
    ],
  },
  {
    id: "innerscene",
    title: "Male base mesh, 3D person, rigged A-pose",
    role: "Skinned human body with a 163-bone skeleton",
    creator: "Innerscene Corp, adapted from MakeHuman CC0 assets",
    sourceUrl:
      "https://www.innerscene.com/tools/library/3d-parts/male-base-mesh-3d-person-rigged-a-pose-380e6d89",
    sourceRevision: "Library part 380e6d89, added 2026-10-18",
    retrieved: RETRIEVED,
    licence: {
      name: "CC0 1.0 Universal (public domain)",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      attribution:
        "Innerscene Corp (innerscene.com), adapted from MakeHuman CC0 assets. Credit is not required; it is given as good practice.",
      attributionRequired: false,
    },
    files: [
      {
        path: RIG_PATH,
        bytes: 4_498_248,
        sha256: "86c7cdfa989924b45e2e5110c131a4a4e6251ceb4e71246be68e468f3a32ca86",
      },
    ],
    modifications: ["None. The file is served exactly as downloaded."],
    caveats: [
      "The library keeps files for a limited time (this one until 2031-10-18), so the local copy is the durable one.",
      "The file's own metadata states CC0 and the Innerscene library terms dedicate contributions to CC0. The MakeHuman project licenses its base mesh, targets and exported models CC0.",
    ],
  },
  {
    id: "animation",
    title: "Jumping Jacks (human rig clip)",
    role: "Technical movement test: whole-body motion including shoulder and hip abduction",
    creator: "Scott Petrovic and the Mesh2Motion project",
    sourceUrl: "https://github.com/Mesh2Motion/mesh2motion-app",
    sourceRevision:
      "main @ eef2de986dab53283cb636f860d502d64b8073e7, file static/animations/human-addon-animations.glb",
    retrieved: RETRIEVED,
    licence: {
      name: "CC0 1.0 Universal (public domain)",
      url: "https://github.com/Mesh2Motion/mesh2motion-app/blob/main/LICENSE-CC0.MD",
      attribution:
        "Mesh2Motion (mesh2motion.org) by Scott Petrovic. Credit is not required; it is given as good practice.",
      attributionRequired: false,
    },
    files: [
      {
        path: MOTION_PATH,
        bytes: 65_564,
        sha256: "c6b629c19ae63b13e322394f858e0e3137743c5da97f88d6e38d8509a46ff483",
      },
    ],
    modifications: [
      "Trimmed with glTF Transform 4.5.1: 74 of 75 clips removed, and the mannequin mesh, skin and texture removed. Only the skeleton node tree and the Jumping Jacks tracks remain.",
      "The clip is then retargeted at runtime to the Innerscene skeleton (see lib/lab/lab-retarget.ts). No keyframe in the source file was edited.",
    ],
    caveats: [
      "The Mesh2Motion README states that the art assets (models, rigs, animations) are all CC0, and LICENSE-CC0.MD says the same. The Blender source for this clip (rigs/human/animation-human-jumping-jacks.blend) sits in the CC0-licensed mesh2motion-assets repository.",
      "The project does not record authorship per clip, and its site says some human animations come from Quaternius (also CC0). No clip from the separate motion-capture set or the CMU sample was used.",
      "This is a stylised game animation, not a clinically reviewed exercise demonstration.",
    ],
  },
];

export const LAB_SUPPORTING = [
  "Three.js, React Three Fiber and Drei (MIT) are already project dependencies. No dependency was added for the lab.",
  "glTF Transform 4.5.1 (MIT) was used once, outside the repository, to trim the animation file.",
];
