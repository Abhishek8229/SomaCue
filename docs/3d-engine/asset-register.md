# 3D engine asset register

## Body (current): `apps/web/public/models/athlete-male.glb`

| Field | Value |
|---|---|
| Source | Character Creator 4 export, "Realistic Human Basemesh - Rigged - Game-Ready / Male Body", Unity pack layout (`unity.Fbx`, `unity.fbm/`, Unity HDRP texture packs). The export path in its `unity.json` names that Reallusion content pack. |
| Licence | **Not verified.** The Character Creator pack's terms were not available when this was built. Confirm they allow shipping the model in a public web app before any public deployment. The file is served as a static asset, so anyone can download it. |
| Built by | `node scripts/athlete-male/build.cjs <export dir>` (its own `package.json`, outside the pnpm workspace; run `npm install` there first). The source export has been deleted from the repository, so rebuilding needs the export again. |
| Files | `athlete-male.glb` (1,037,848 bytes, textured) and `athlete-male-lite.glb` (232,848 bytes, no textures). Same skeleton and geometry. |
| Geometry | Skin 25,095 triangles in one primitive (head, body, arm and leg merged), boxers 1,212, eyes 272. 93 joints, all three meshes on the same skeleton. 1.80 m standing height, soles on y = 0, facing +Z, the figure's left at +X. |
| Textures | WebP. Skin: 2x2 atlas of 1024 px tiles for base colour and normal, plus one 512 px-tile ORM map (AO from the Unity AO map, roughness = 1 - Unity smoothness, metallic 0). Normal maps are converted from DirectX to OpenGL (green flipped). Boxers 512 px, eyes 256 px. Nails, eyelashes, teeth, tongue, tear lines and eye occlusion are not included. |
| Compression | `gltf-transform meshopt` (Meshopt, not Draco, so it also decodes in plain Node). Loaded with `MeshoptDecoder` in `lib/load-model.ts` and `lib/kinematics/node-body.ts`. |
| Bone mapping | `lib/kinematics/rig.ts`, `RIG_BONE_NAMES`: pelvis = `CC_Base_Hip`, spine = `Waist`, `Spine01`, `Spine02`, neck = `NeckTwist01`, plus `Head`, `Clavicle`, `Upperarm`, `Forearm`, `Hand`, `Thigh`, `Calf`, `Foot`, `ToeBase`, `MidToe1` (stands in for the missing toe tip). CC4 skin weights sit on helper bones (twist, share, finger and toe bones); each is assigned to the nearest mapped ancestor for contact groups and capsule radii. The rest pose is an A-pose; `createBodyRig` swings the arms down. |
| Headless fallback | Tests, server actions and `verify:motion` load `athlete-male-lite.glb`. The stage falls back to it if the textured file cannot load. |
| Render notes | The skin keeps its authored textures. The skin material is double-sided because the body mesh is open at the fingertips (the nail mesh was not kept). The boxers are pushed out 4 mm so skin does not poke through deep hip folds. |
| Verified | `pnpm verify:motion`: 18 of 18 exercises pass (0 mm slip, 0 mm self-overlap, floor within 2 mm). |

## Retired body

The first body, `soma-body.glb` (Quaternius *Universal Base Characters*, CC0 1.0), was replaced by the Character
Creator athlete above. The file and its build script (`scripts/build-soma-body.mjs`) were removed once nothing
loaded them. They remain in Git history if the free CC0 body is ever wanted again.