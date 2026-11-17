# 3D engine asset register

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
