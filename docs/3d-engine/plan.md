# Full-body 3D rehabilitation engine: build spec

Status: **built** (v1). Sections 1 to 15 are the original spec; "Build status" below records what was actually built and where it differs.

## Build status (v1)

**What exists**
- Body: Quaternius Superhero male (the free pack has no Regular body), a CC0 body that has since been replaced by the Character Creator athlete (`pnpm build:body` now runs `scripts/athlete-male/build.cjs`). See `asset-register.md`.
- Engine, pure TypeScript in `apps/web/lib/kinematics/`:
  - `vocabulary.ts`, `joint-table.ts`: draft ranges with sources, `CLINICAL_RANGES_REVIEWED = false`.
  - `movement-spec.ts`, `timeline.ts`, `postures.ts`, `rig.ts`, `solver.ts`, `engine.ts`.
  - `validate.ts`, `plan-repair.ts`, `reference-exercises.ts` (18), `regions.ts`, `camera-presets.ts`, `exercise.ts`, `node-body.ts`.
- Stage UI in `apps/web/components/stage/`:
  - `StageV2` replaced the placeholder `StagePanel`.
  - `StageCanvas` handles R3F, the glow material and camera framing.
  - `useStageController` drives Prev, Play, Next and speed.
  - `StopReportForm` and `SafetyNotice` serve Pain Override.
- Pain Override: `actions/painEvent.ts`, with migration `20261115090000_add_pain_event_and_stop` applied to Neon on 2026-11-15. The migration adds the `PainEvent` table and `DailyProgress.stoppedAt`.
- AI: steps carry a `movement` spec, and new plans require it. Every plan and reschedule is repaired on the real body before saving (`plan-repair.ts`). Red-flag reschedules strip movements that load the reported regions.
- Checks: `pnpm verify:motion` passes 18 of 18 and writes `motion-report.json`. Unit tests are in `apps/web/__tests__/kinematics-*.test.ts`, `painEvent.test.ts` and `StopReportForm.test.tsx`.

**Differences from the spec**
- **Repair step:** the server repairs deterministically: it clamps, validates, then substitutes a reference exercise or drops the motion. It does not make a second AI call, which would add one to two minutes.
- **Quadruped support:** quadruped postures always keep both hands and knees on the floor. Spinal flexion is shared with an opposite pelvic tilt so cat-cow arches in the middle, and the arms are kept vertical.
- **Lying arms:** in lying postures, arms the exercise does not use rest on the floor.
- **Prescribed fraction:** the fraction is 0.8, except shoulder and hip flexion at 0.9, so overhead reaches and seated knee lifts stay visible.
- **AI timeouts:** both are 180 s. A live red-flag reschedule with movement specs took 117 s.
- **Not changed:**
  - `lib/safety/engine.ts`, which is still spine-only and unwired.
  - Body-map tapping (`regionAtPoint` exists, but no UI uses it).
  - The legacy orphans in `components/workspace/` (`StageCanvas`, `StagePanel`, `Workspace`, `TopBar`, `GuidancePanel`, `AssetNotes`) and `app/workspace/Workspace.module.css`.

## Original spec

Scope: the center stage of the workspace (`apps/web/app/workspace`). A full-body 3D figure that moves live, in real time, to mimic any exercise the AI prescribes, for any body region (cervical, thoracic and lumbar spine, shoulders, elbows, wrists, hips, knees, ankles) and any posture (standing, seated, supine, prone, quadruped). No pre-animated clips.

## 1. Final product decisions

| # | Decision | Detail |
|---|---|---|
| 1 | Mannequin | Quaternius [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html), **Regular male body only for v1**. CC0, about 13k triangles, humanoid rig, glTF. Hair and face details removed, one matte clinical material. The old `/3d-lab` MakeHuman mesh is not used in the workspace (the lab page itself stays untouched). Female body is a later add-on on the same rig. |
| 2 | Camera views | Standing, seated and quadruped: **Anterior / Posterior** (front / back). Supine and prone: the two buttons are relabelled **Top / Side**. Top is a high angled view from above, Side is a clear lateral view. |
| 3 | Pain Override | A red-flag stop (sharp pain or sudden loss of movement). One tap, no confirmation. Aborts the whole active session, eases the figure to a safe resting pose, glows the affected area red, and opens a dedicated "Stop and report" form. A standard "seek urgent care" notice is always visible. The patient describes what happened in their own words. |
| 4 | Motion engine | A real-time kinematics engine driven by textbook biomechanics (postures, joints, anatomical planes and motions). The AI prescribes in that vocabulary and the figure mimics it live. Joint ranges come from an AI-drafted baseline table grounded in standard physiotherapy references, flagged "draft, not clinically reviewed" until a clinician signs off (before any public patient rollout). |

Judgment calls made on the owner's behalf (revisit if wrong):

- Quadruped uses Anterior / Posterior labels (only lying postures switch to Top / Side), with a 3/4 side default framing because it shows cat-cow and bird-dog best.
- Closing the Stop form does not resume the session. Only the existing Reset button clears a stopped day.
- The safety notice shows immediately on Pain Override and does not depend on the form being submitted.

## 2. Working agreements and environment (read before building)

- **Do not commit** unless the owner asks. **Do not add tests** unless the owner asks (the engine validator in section 6.8 is proposed, confirm at build time).
- Windows, PowerShell. Run shell commands with `cwd` `D:\SomaCue`. Checks: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`. Baseline: `__tests__/workspace.test.tsx` fails because it imports `page.tsx`, which needs `DATABASE_URL` (unrelated to this work).
- **Next.js 16.4.3 has breaking changes.** `AGENTS.md` requires reading the relevant guide in `apps/web/node_modules/next/dist/docs/` before writing code (server actions, client components, `revalidatePath`).
- **Database:** Neon Postgres, live. Migration history has drifted. **Never** run `prisma migrate dev`, `migrate reset`, `db push` or `migrate deploy`. Hand-write SQL under `prisma/migrations/<timestamp>_<name>/migration.sql` (use `pnpm exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` offline to copy exact DDL). The owner applies migrations. After editing the schema run `pnpm db:generate` (does not touch the DB). Existing applied migration: `20261114090000_add_daily_progress`.
- **Never print or copy `apps/web/.env`.** It holds live secrets.
- Server actions return `{ success: false, error }` for expected failures (production masks thrown messages). Follow `apps/web/actions/dailyProgress.ts`.
- UI copy: no em dashes. Match the dark clinical look (Tailwind zinc and emerald panels, `workspace-*` classes and tokens in `app/globals.css` and `app/tokens.css`, amber `--workspace-signal` for the calendar).
- Throwaway scripts that touch the DB must run from `apps/web` (where `pg` is installed), must never be left in the repo, and any write to live data needs a backup first.
- AI provider is OpenRouter, model `nvidia/nemotron-3.5-super-vl:free`. Calls are slow (a reschedule took about 47 s before trimming). Default timeout is 60 s, reschedule uses 120 s. `generateObject` is deprecated in the installed AI SDK (a warning prints). Moving to `generateText` with an output setting is optional and should only happen if low risk.

## 3. Current state of the repo (facts)

**Stage and controls (placeholder):**
- `StagePanel` in `apps/web/app/workspace/WorkspaceParts.tsx` is a CSS "3D" circle, props `{reportsSubmitted, planUnlocked, selectedCareDay}`, `col-span-6` when the plan is unlocked.
- `WorkspaceClient.tsx` footer: Prev, Play (only toggles `isPlaying` text), Next, 0.5x, 1.0x, Voice feedback and Pain Override are all inert. "Session 04 / Set 2 of 3 / 12 Reps" is hardcoded.

**Exercise data today:** steps are `{exerciseName, animationTriggerId, durationSeconds, voiceCue}` from `apps/web/actions/generatePlan.ts` (`treatmentStepSchema`). The base plan has exactly 3 steps. Schedule days may carry their own `steps` (1 to 5) after a "More discomfort" reschedule. `animationTriggerId` is consumed by nothing. No posture, region, side, plane, reps or tempo exists.

**Already built in the workspace (do not break):**
- `lib/progress/dailyProgress.ts`: pure helpers and types (`toDateKey`, `getDayExercises`, `collectExerciseNames`, `feedbackSubmissionSchema`, `mergeRescheduledSchedule`, `findRescheduleProblem`, `recordRescheduleBackup`, `restoreScheduleForReset`, `applyScheduleRestore`, `withoutBackups`, types `StoredTreatmentPlan`, `ScheduleDayWithSteps`, `DailyProgressRecord`).
- `actions/dailyProgress.ts`: `toggleExerciseCompletion`, `submitDailyFeedback` (saves first, then AI reschedule for "issue", stores a pre-reschedule backup under `routine.rescheduleBackups[dateKey]`), `resetDailyProgress` (deletes the day's row and restores the schedule from the backup).
- UI: `components/workspace/DailyPrescriptionPanel.tsx`, `FeedbackModal.tsx`; `WorkspaceClient.tsx` owns `progressByDate`, `selectedCareDay`, `selectedExercises`, `treatmentPlan`, `isPlaying`.
- Prisma `DailyProgress` (unique on `clinicalReportId + dateKey`).
- `actions/generatePlan.ts` `rescheduleTreatmentPlan(symptoms, plan, report)` with the discomfort report; `AI_RESCHEDULE_TIMEOUT_MS = 120000`.

**Legacy code, no importers found:** `app/workspace/Workspace.module.css`, and `components/workspace/{StageCanvas,StagePanel,Workspace,TopBar,GuidancePanel,AssetNotes}.tsx` (a stale mock of `StagePanel` remains in `__tests__/workspace.test.tsx`). Port these pieces, then delete the orphans once confirmed unused:
- scene error boundary, PMREM `RoomEnvironment` lighting, drei `ContactShadows` and `Grid`,
- the `ViewCommand` (id plus type) camera command pattern,
- `lib/stage-palette.ts` (design tokens to sRGB for three.js),
- `useWebGLSupport` and `usePrefersReducedMotion` in `lib/use-environment.ts`,
- WebGL-context-lost handling and the static fallback images.

**3D tooling:** three 0.187, @react-three/fiber 9.8.2, drei 10.7.9. three ships `KTX2Loader`, the meshopt decoder and `CCDIKSolver`. `lib/load-model.ts` uses a bare `GLTFLoader` (no meshopt or Draco), so a decoder must be added if the final GLB is compressed.

**Lab (keep, do not extend):** `/3d-lab` and `lib/lab/*` hold a prior experiment on the MakeHuman mesh. Its retargeting code (`lab-retarget.ts`) is a useful reference for world-space rotation retargeting. Its results are a historical baseline (`docs/3d-lab/phase-2a-notes.md`). The 33 MB human atlas is out of scope.

**Safety rulebook:** `lib/safety/engine.ts` is a pure deterministic filter by movement plane, spine-only, not yet wired into plan generation.

## 4. Architecture overview

```
AI plan (movement specs in textbook vocabulary)
        |  zod + joint table clamp (same code on server and client)
        v
Server action: validate, repair or reject, then save to TreatmentPlan.routine
        v
Client: Stage controller (play, pause, speed, exercise index, view, stopped)
        v
Kinematics engine (pure TS, no React): spec + time -> joint angles
        -> bone rotations -> grounding -> IK pins -> limits -> probes
        v
Three.js scene: Quaternius body (skinned), capsule glow material, camera rig
```

Key rule: the AI never outputs bone names, coordinates or angles outside the joint table. Everything the figure does comes from bounded, validated textbook terms.

## 5. Mannequin and rendering

**Asset:** Quaternius Universal Base Characters, Regular male. Place the glTF at `apps/web/public/assets/stage/soma-body.glb` (or the original name) with a licence and attribution note in `docs/3d-engine/asset-register.md`.

**Acquisition risk:** the pack downloads from quaternius.com in a browser and may not be fetchable by tools. If it cannot be fetched, ask the owner to download the glTF zip and place it in `apps/web/public/assets/stage/source/`. A fallback source is the CC0 character inside the public `UMRAM-Bilkent/supine-human-model` repo (`assets/human.glb`, rigged), which notes a large node scale to apply (about 69x). Verify it is the Regular male before using.

**Asset prep (one time, outside the repo or via a script that is kept in `scripts/`):** remove hair, eyes and clothing meshes, apply uniform scale so the figure is about 1.75 m with feet at y = 0, face +Z, Y up, weld normals, cap at 4 skin weights per vertex, keep one material, optionally meshopt and quantize with glTF-Transform. Record triangles, bones, file size.

**Look:** matte cool sage mannequin colour from stage tokens, standard PBR (roughness about 0.6, low environment intensity), a fresnel rim in emerald added through a small `onBeforeCompile` patch, no post-processing, `ContactShadows` refreshed only while the figure moves, device pixel ratio capped near 1.5, `frameloop="demand"` when paused.

**Phase-0 visual gate:** render the stripped, re-materialed body from front, side, back and top. If it looks wrong or the rig lacks usable spine, neck, clavicle, hand or foot bones, stop and switch asset (fallback: Blender Studio CC0 Human Base Meshes, needs rigging).

**Rig map:** a file `lib/kinematics/rig-map.ts` maps canonical joints to the Quaternius bone names (confirm names when the file is available). The engine only ever uses canonical joints. A calibration step at load computes each bone's rest orientation and local axes from the bind pose, so clinical angle directions (flexion, abduction, rotation) are correct for this specific mesh.

## 6. Kinematics engine

All of it is pure TypeScript with no React or DOM, in `apps/web/lib/kinematics/`, so the server and the browser run identical code.

### 6.1 Vocabulary (the only things the AI may say)

- **Postures:** standing, seated, supine, prone, quadruped (side-lying is a possible later addition).
- **Anatomical planes:** sagittal, frontal, transverse.
- **Motions:** flexion, extension, hyperextension, abduction, adduction, internal rotation, external rotation, lateral flexion, rotation (trunk and neck), elevation, depression, protraction, retraction, dorsiflexion, plantarflexion, inversion, eversion, supination, pronation, radial and ulnar deviation, anterior and posterior pelvic tilt.
- **Segments and joints:** cervical spine, thoracic spine, lumbar spine, pelvis, scapula, shoulder (glenohumeral), elbow, forearm, wrist, hand, hip, knee, ankle, foot, each with a side where relevant.
- **Regions** (for highlighting and safety rules): head, cervical, thoracic, lumbar, pelvis, shoulder L/R, elbow L/R, wrist and hand L/R, hip L/R, knee L/R, ankle and foot L/R.

### 6.2 Joint table (`lib/kinematics/joint-table.ts`)

One data file. Each row: `segment`, `motion`, `plane`, `normalMinDeg`, `normalMaxDeg`, `prescribedMaxFraction` (default 0.8, rehab patients usually have less range), `source` (named textbook or reference), `status: "draft-unreviewed"`.

- Values are drafted once, offline, with AI help, grounded in standard physiotherapy references (for example the AAOS joint motion norms, Norkin and White "Measurement of Joint Motion", Kapandji). **Do not generate them at runtime.**
- At build time, look up the real published numbers with web search and cross-check each row against at least two sources, instead of trusting memory. Record the source per row.
- A single exported flag (for example `CLINICAL_RANGES_REVIEWED = false`) keeps public rollout blocked and shows a small "prototype, ranges not clinically reviewed" label on the stage until a clinician signs off.
- Clamping uses `min(normal range, prescribed fraction)` on both the server (at plan save) and the client (every frame).

### 6.3 Movement spec (what the AI returns for each exercise)

A zod schema in `lib/kinematics/movement-spec.ts`, using enums from the vocabulary and numeric bounds from the joint table:

- `exerciseName`, `clinicalSummary` (one or two sentences), `posture`, `side` (left, right, both, alternate), `targetRegions[]`.
- `movements[]`: each `{segment, motion, targetDeg, fromDeg?}` plus optional `coupled` hints (for example hip and knee together). The plane is derived from segment plus motion.
- `tempo`: `upSeconds`, `holdSeconds`, `downSeconds`, `restBetweenRepsSeconds`; `reps`, `sets`, `restBetweenSetsSeconds`.
- `pins[]` (end effectors that must stay planted, for example `heel_L`), and `supports` (optional props: mat, chair, wall; defaults come from the posture).
- `cues[]` (spoken or written instructions), `precautions[]`, `stopIf[]` (for example "stop if pain spreads down the leg").
- Back-compat fields kept: `durationSeconds`, `voiceCue`.

Example, back extension (prone press-up): posture prone, movements lumbar extension to about 25 degrees (clamped by the table) with thoracic extension and elbow extension, pins pelvis and thighs on the floor, tempo 2 s up, 2 s hold, 2 s down, 10 reps, cue "keep your hips on the floor and stop at a pain-free height", target region lumbar.

### 6.4 Postures (`lib/kinematics/postures.ts`)

Each posture defines a neutral resting pose (joint angles), the root orientation, and the support surfaces (floor, mat, chair seat at knee height, optional wall) with which body landmarks are in contact (for example supine: back of head, upper back, sacrum, heels). The safe resting pose for Pain Override is the neutral pose of the current posture (a lying figure stays lying, a standing figure stays standing, with relaxed limbs).

### 6.5 Solver, every frame

1. Evaluate the current phase of the active movement (up, hold, down, rest) with minimum-jerk easing to get target angles per segment and motion. Speed (0.5x, 1.0x) scales the clock only.
2. Clamp angles to the joint table.
3. Convert to bone rotations through the rig calibration. Spine bend is distributed across the available spine bones by region weights. Shoulder elevation uses scapulohumeral rhythm (about 2 degrees at the shoulder per 1 at the scapula). Forearm and thigh axial twist is split across twist bones if the rig has them, otherwise applied to one bone.
4. **Grounding:** read about 30 skin probe vertices (heels, toes, knees, hips, buttocks, back of head, shoulder blades, elbows, hands) using `SkinnedMesh.getVertexPosition`. Lift or lower the root so the lowest contact probe sits on the support surface and no probe is below it.
5. **Pins:** keep planted end effectors fixed using analytic two-bone IK (arms and legs). The spine uses joint angles, not IK.
6. **Collision guard:** simple capsule proxies per segment. If non-adjacent capsules overlap by more than a small tolerance, reduce the offending joint angle toward its neutral value until clear. Log a counter in development.
7. Expose live joint and capsule world positions to the glow shader and the camera framing.

### 6.6 Playback model

A small controller with `exerciseIndex`, `phase`, `rep`, `set`, `playing`, `speed`, `stopped` and `restPose`. Prev and Next move between exercises of the selected day (`selectedExercises`). The bottom HUD ("Session / Set x of y / n Reps") is derived from the active spec instead of hardcoded text. When all reps and sets finish, playback stops and the figure eases to its rest pose.

### 6.7 Server-side validation

When the AI returns a plan or a reschedule, the server runs the same engine headless for every exercise:

- schema and vocabulary check, clamp all angles to the table,
- run the solver across the full motion at several amplitude points and check grounding, joint limits, capsule overlap and finite values,
- if anything cannot be made safe, reject and ask the AI again once, otherwise fall back to the closest reference exercise for the same posture and region and record that it was substituted.

The existing `findRescheduleProblem` name check stays, now supplemented by region and motion checks (for example, no `lumbar flexion` movements after a flagged lumbar flexion discomfort).

### 6.8 Reference exercises and validator (proposed, confirm before adding tests)

Ship about 10 hand-checked reference specs, used as AI few-shot examples, as the name-alias fallback for older v1 plans, and as a regression suite:

1. Chin tuck (seated, cervical).
2. Seated trunk rotation (seated, thoracic).
3. Pelvic tilt (supine, lumbar and pelvis).
4. Heel slide (supine, hip and knee).
5. Bridge (supine, hip and lumbar).
6. Ankle pumps (supine, ankle).
7. Prone press-up, back extension (prone, lumbar).
8. Cat-cow (quadruped, thoracic and lumbar).
9. Bird-dog (quadruped, hip and shoulder).
10. Standing arm raise (standing, shoulder), seated knee extension, seated elbow flexion, seated wrist flexion and extension (cover knee, elbow, wrist).

A CLI (`pnpm verify:motion`, to be created) runs all references and prints a report. Proposed starting thresholds, set before measuring: contact probes at or above -2 mm, planted-pin slip at most 5 mm, zero joint-limit violations after clamping, capsule penetration at most 5 mm, no non-finite values. Skin pinching at extreme angles cannot be detected automatically and needs visual review.

## 7. Camera, views, regions and glow

**View rules**

| Posture | Button 1 | Button 2 |
|---|---|---|
| Standing, seated | Anterior (front) | Posterior (back) |
| Quadruped | Anterior | Posterior (default framing is 3/4 side) |
| Supine, prone | **Top** (high angled view from above, from the foot end) | **Side** (clear lateral view) |

Switching exercise to a different posture eases the camera to that posture's default. Dragging the view hands control to the user until "Reset view" or a view button is pressed. Camera transitions use a critically damped spring and are instant under reduced motion.

**Auto-framing:** fit the bounding sphere of the active region (or whole body) using the field of view, smoothed so the camera does not jitter as the body moves. Each region has a preferred side (for example lumbar from the back or side, knee from the side, shoulder from the front).

**Region glow:** pass up to 8 capsules (two live joint positions plus radius, colour and intensity) to the body material as uniforms. A small fragment-shader patch (through `onBeforeCompile`) computes distance to each capsule and adds a soft emissive and rim glow. It works for any joint or segment under animation with no extra meshes. Active-exercise regions glow emerald, Pain Override glows red with a pulse (a static ring under reduced motion), and regions the patient flagged earlier show a calm amber ring.

**Body-map picking:** tapping the figure raycasts against the same capsule proxies (not the skinned mesh) and returns a region.

**Fallbacks:** no WebGL or context loss shows a static poster and a text description of the exercise (posture, motions, tempo, cues). The text view must always be available for accessibility.

## 8. Pain Override: the red-flag stop

**Behavior (single click, immediate, no confirmation):**
1. Stop playback and cancel any spoken cue or timer.
2. Mark the session `stopped` in the stage controller. Disable Play, Prev, Next and speed.
3. Ease the figure to the safe resting pose for its posture (about 0.6 s, snap under reduced motion).
4. Glow the exercise's target regions red.
5. Show the "seek urgent care" notice and open the dedicated "Stop and report" form.

**Safety notice (draft wording, needs legal and clinical review before public rollout):** "Stop exercising. If you have sudden severe pain, chest pain, numbness or tingling, loss of bladder or bowel control, or you cannot move an arm or leg, get urgent medical care now. Call your local emergency number." The emergency number is configurable (for example `NEXT_PUBLIC_EMERGENCY_NUMBER`, shown only if set). The notice is visible above the form and on the persistent "Session stopped" banner. The app is not an emergency service and the copy must not imply it is.

**Stop and report form** (new component, separate from `FeedbackModal`):
- Which exercise caused it: chips from today's exercises, current one pre-selected, at least one required.
- What happened: sharp pain, sudden loss of movement, other (required).
- Where: body region chips, pre-selected to the highlighted region, editable. Optional body-map tap.
- What happened in your own words: required textarea, same 1000-character limit as other feedback, treated as plain data everywhere (JSON-quoted in AI prompts).
- Captured automatically: exercise, rep, set, phase and angle at the moment of the stop.

**Closing the form without submitting:** the session stays stopped, the banner stays with a "Report what happened" button. Only Reset clears it.

**Data model (needs a hand-written migration the owner applies):**
- New `PainEvent`: `id`, `clinicalReportId`, `patientId`, `dateKey`, `exerciseNames String[]`, `painType`, `regions String[]`, `details`, `context Json` (exercise, rep, set, phase, angles), `createdAt`. Index on `patientId` and on `clinicalReportId, dateKey`.
- `DailyProgress` gets `stoppedAt DateTime?` (the day is not completed). The row is created if it does not exist. `resetDailyProgress` already deletes the row, which clears the stop. `PainEvent` rows stay as history.

**Server action** (`actions/painEvent.ts`, `"use server"`, same auth, ownership and date-window checks as `dailyProgress.ts`): validates input with zod, saves the event and `stoppedAt` first, then runs the discomfort reschedule with a `redFlag` marker so the plan is more conservative (flagged movements removed from later days, and the plan notes that clinician review is advised). AI failure must not lose the report (same pattern as `submitDailyFeedback`). Reuse the `rescheduleBackups` mechanism so Reset restores the schedule.

**UI effects:** `DailyPrescriptionPanel` shows a "Session stopped" state with the notice and a Reset action, and "Done for today" is disabled. The calendar shows a small red marker (new `.workspace-calendar-stopped` class next to `.workspace-calendar-done`) instead of the completion dot.

## 9. AI integration

- Replace the exercise step shape with the movement spec (section 6.3). Keep `exerciseName` as the stable display name and as the key used by `DailyProgress` and discomfort feedback so nothing already saved breaks. Keep `animationTriggerId` and `voiceCue` optional for old plans.
- Prompt changes in `generatePlan.ts` (`generateFinalRoutine` and `rescheduleTreatmentPlan`): explain the vocabulary, give the reference exercises as few-shot examples, forbid bone names and out-of-table angles, and require movement specs only for exercises the AI introduces or modifies.
- **Latency control:** to keep output short, the plan carries a per-plan exercise dictionary keyed by `exerciseName`. Reschedules reuse existing definitions by name and send full specs only for new or changed exercises. Measure real latency at build time against the 60 s and 120 s limits.
- Extend `lib/safety/engine.ts` regions beyond the spine and make its rules operate on the real joint motions in each spec, with a deterministic veto after the AI answers. Clinical rule content still needs sign-off later.
- Old (v1) plans: resolve a step to a reference spec by name match, otherwise show a text-and-pose card with the target region highlighted and no fake motion.
- Existing "More discomfort" feedback keeps working, and the discomfort region (new optional field) improves the reschedule prompt.

## 10. Module and file map

```
apps/web/lib/kinematics/        pure TS, no React
  vocabulary.ts  joint-table.ts  postures.ts  movement-spec.ts
  solver.ts  grounding.ts  ik.ts  collision.ts  validate.ts
  rig-map.ts  regions.ts  camera-presets.ts  reference-exercises.ts
apps/web/components/stage/      React and three
  StageV2.tsx (replaces the placeholder StagePanel)  StageCanvas.tsx
  BodyModel.tsx  BodyMaterial.ts (glow patch)  CameraRig.tsx
  StageControls.tsx  StopBanner.tsx  StopReportForm.tsx  useStageController.ts
apps/web/actions/painEvent.ts
apps/web/public/assets/stage/    soma-body.glb (+ source folder if needed)
prisma/schema.prisma + migrations/<ts>_add_pain_event_and_stop/
docs/3d-engine/asset-register.md
scripts/                         asset prep script, verify-motion (if approved)
```

Touch points in existing files: `WorkspaceClient.tsx` (replace `StagePanel` use, wire footer controls, stopped state, HUD), `WorkspaceParts.tsx` (remove placeholder `StagePanel`), `DailyPrescriptionPanel.tsx` (stopped state), `WorkspaceClient.tsx` calendar (red marker), `globals.css`, `generatePlan.ts`, `lib/safety/engine.ts`, `lib/load-model.ts` (meshopt decoder if used), `app/workspace/page.tsx` (load stopped state with progress).

## 11. Build sequence (work packages, each ends with typecheck, lint and build)

Keep a short-lived feature flag (for example `NEXT_PUBLIC_STAGE_V2`) while building so the old placeholder remains available, then remove it with the legacy code once done.

- **WP0 Asset check.** Obtain the Regular male glTF, strip and re-material it, render four views, list bones, record triangles and size. Gate: owner-visible screenshots look right and the rig has spine, neck, clavicle, arm, hand, leg and foot bones. Otherwise stop and switch asset.
- **WP1 Stage shell.** `StageV2`, canvas with ported pieces, body loading, material, lighting, floor, error and no-WebGL fallback, view buttons with posture rules, Prev, Play, Next, speed, `useStageController`, HUD wiring. Neutral pose only.
- **WP2 Rig calibration and joint table.** Rig map, bind-pose calibration, vocabulary, joint table with sources and cross-check, posture neutral poses. Gate: each joint, driven by a test angle, moves in the correct anatomical direction on the real mesh.
- **WP3 Solver.** Phases and easing, angle to bone conversion, spine distribution, shoulder rhythm, grounding probes, pins and two-bone IK, joint clamps, capsule guard.
- **WP4 Reference exercises and validator.** About 10 specs across all postures and regions, `verify:motion` report against the section 6.8 thresholds, visual review screenshots.
- **WP5 Glow, framing, picking.** Capsule glow material, region taxonomy, auto-framing, Top / Side and Anterior / Posterior transitions, region picking, flagged-region rings.
- **WP6 Pain Override.** Controller stop state, rest-pose easing, red glow, notice, `StopReportForm`, `PainEvent` migration and action, `DailyProgress.stoppedAt`, panel and calendar states, reschedule with `redFlag`, Reset integration.
- **WP7 AI integration.** Schema v2, prompts, server validation and repair, safety engine extension, v1 back-compat, latency measurement.
- **WP8 Hardening.** Dispose and context-loss handling, reduced motion, keyboard and screen-reader pass for all stage controls and the stop flow, text alternative of each exercise, performance check against budgets, remove the feature flag and the orphaned legacy files, update `docs/3d-engine/asset-register.md` with attribution and the licence note.

## 12. Budgets and thresholds (starting values, measure and adjust)

| Item | Target |
|---|---|
| Body triangles | 20k or fewer |
| Skin weights per vertex | 4 |
| Body draw calls | 1 |
| Body file size | about 1 MB or less on the wire |
| Frame rate | 55 fps or better on a mid laptop integrated GPU |
| Engine CPU per frame | about 1.5 ms or less |
| Device pixel ratio cap | about 1.5 |
| Grounding | probes at or above -2 mm |
| Planted-pin slip | 5 mm or less |
| Capsule penetration | 5 mm or less |
| Joint-limit violations after clamp | 0 |

## 13. Risks and mitigations

- **Asset download or look fails.** WP0 is a hard gate with a named fallback.
- **Rig has too few spine bones for regional spine motion.** Distribute by region weights across what exists. State the limit honestly in the UI (regional, not per vertebra).
- **AI-drafted ranges are wrong.** Source per row, two-source cross-check, safety fraction, `draft-unreviewed` status, the rollout-blocking flag, hard clamps on server and client.
- **Free-form exercises can still clip at extreme angles.** Runtime grounding and capsule guard, server-side rejection and repair, reference-suite regression, visual review of tricky compositions. No promise of zero clipping for arbitrary input.
- **AI latency grows with richer specs.** Exercise dictionary, reuse by name, reschedule sends only changes, deterministic repair before any second AI call.
- **Stopped-session semantics.** Stopped never counts as completed. Reset is the only way back. PainEvent rows are history and survive Reset.
- **Migration friction.** Hand-written SQL, owner applies it. The app must degrade clearly (not crash silently) if the tables are missing, with a message pointing to the migration.

## 14. Needed from the owner at build time

1. The Quaternius Universal Base Characters glTF zip, if the agent cannot download it (see section 5).
2. Applying the new migration (`PainEvent` and `DailyProgress.stoppedAt`) to the Neon database.
3. A yes or no on adding the pure-engine unit tests and the `verify:motion` CLI.
4. Optionally an emergency number for the safety notice (otherwise the notice says "your local emergency number").
5. Later, before public rollout: clinician sign-off on the joint table, the safety notice wording, the safety rules and the reference exercises, plus legal review.

## 15. Not verified

- The Quaternius rig has not been opened. Bone names, bone count, spine segmentation, hand detail and the node scale are unknown until WP0.
- How the stripped mannequin looks with our material is unknown until WP0.
- Joint range numbers are not written yet. They must be looked up and cross-checked at build time.
- Size and performance numbers are targets, not measurements.
- The `/3d-lab` numbers quoted in earlier notes are a historical baseline.
- Whether GLB loading and skinned-vertex sampling work headless on the server (needed for section 6.7) is untested. If it does not, the server validates angles and tempo only and the full solver check runs in the browser and in CI.
