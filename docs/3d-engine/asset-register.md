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

The previous body (`soma-body.glb`, Quaternius, CC0) described below is no longer loaded by the app.

## Body: `apps/web/public/assets/stage/soma-body.glb`

| Field | Value |
|---|---|
| Source | Quaternius, *Universal Base Characters* (Standard, free version), https://quaternius.com/packs/universalbasecharacters.html |
| File used | `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf` and `.bin` |
| Licence | CC0 1.0 Universal (public domain), stated in `License_Standard.txt` inside the pack |
| Attribution | Not required. Given as good practice: "Body model by Quaternius (quaternius.com), CC0." |
| Built by | `pnpm build:body` (`scripts/build-soma-body.mjs`), from the zip in `apps/web/public/models/` |
| Modifications | All textures and images removed. The body keeps POSITION, NORMAL, JOINTS_0 and WEIGHTS_0 with one plain material (the app replaces it with a warm studio-mannequin material at runtime). The eyes and eyebrows are kept as separate skinned meshes on the same skeleton: eye iris and pupil are painted into vertex colours (no texture), brows use a plain dark material. The body surface is softened in the bind pose: light volume-preserving smoothing on the torso and limbs to tone down the superhero muscle lines (face, hands and feet untouched), upper arms slimmed toward the bone axis (up to 13% at the deltoid), hands 10% smaller about the wrist. Normals are recomputed with seams welded. Bones, joint positions, inverse bind matrices and skin weights are unchanged (verified: 0 m joint displacement, all three meshes bound to the same 65 joints), so every movement is identical. |
| Result | 489,096 bytes, 12,566 body triangles, 7,281 body vertices, 65 joints, 1.818 m standing height |

Note on the body choice: the decision was the *Regular* male body. The free Standard pack only ships
the *Superhero* bodies, so v1 uses Superhero male. Every body in the pack shares the same universal
skeleton, so a Regular body from the paid Source pack can replace it by running
`node scripts/build-soma-body.mjs <zip> Regular_Male_FullBody` (check the exact file name), with no
code change, provided the bone names stay the same (`lib/kinematics/rig.ts`, `RIG_BONE_NAMES`).

The source zip (about 129 MB) is not served or committed: `apps/web/public/models/` is in `.gitignore`.
It still sits under `public/`, so move it out of the repository before any deployment.
