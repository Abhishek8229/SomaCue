# SomaCue Stage 4 — 3D feasibility prototype

A bounded technical spike, not a product build. It tests whether one interactive
lumbar anatomy model and one rigged exercise clip can share a single
3D-dominant workspace without inventing clinical content.

**Status:** prototype complete and verified. Stop point for Stage 4.

## What it proves

- A 35% guidance rail and a 65% dark stage hold both demonstrations in one
  screen. On mobile the stage comes first and the guidance sits beneath it.
- One real L4 vertebra can be orbited, zoomed and reset, with front, side and
  back presets that follow the exported file axes.
- One real standing cat-cow clip can be played, paused, replayed, scrubbed and
  slowed without autoplay. Speed changes the visual rate only.
- Every required non-happy path is visible and usable: loading, model failure,
  WebGL unavailable, and a static/text fallback.
- Light and dark themes work, with the system preference used on first visit
  and a manual choice persisted locally. The stage stays dark in both themes.
- Completion is a local-only mark, with no account or server call.

## Run it

Requires Node.js 20+ and npm. This prototype uses npm because pnpm was not
available in the working environment; the promotion note covers the move to the
approved pnpm monorepo.

```bash
npm install
npm run dev        # http://localhost:3100
```

Production check:

```bash
npm run build
npm start          # http://localhost:3100
```

Quality gates:

```bash
npm run lint
npm run typecheck
```

## Routes and interactions

| Action | Where |
| --- | --- |
| Movement demo (default) | `/` |
| Anatomy demo | `/?view=anatomy` |
| Switch demo | Stage tabs; arrow keys move between tabs |
| Play / pause / replay | Movement transport |
| Scrub | Range input under the clip; time is the real clip time |
| Speed | 0.5×, 0.75×, 1×, 1.25×, 1.5× |
| Orbit / zoom | Drag and scroll on the anatomy stage |
| Front / side / back / reset | Anatomy controls |
| Text view | Stage header; swaps the live canvas for a captured still |
| Asset notes | Top bar; native modal dialog, closes with Escape |
| Theme | Top bar toggle; stored under `somacue.theme` |
| Mark demo complete | Guidance footer; stored under `somacue.demo.<id>.complete` |

The movement demo starts paused. There is no autoplay. The anatomy stage starts
interactive and has no animation.

## Structure

```
app/
  layout.tsx           fonts, metadata, prepaint theme script
  page.tsx             server-side ?view=anatomy initial state
  globals.css          Hallmark stamp, imports, global shell
  tokens.css           light/dark palette and static stage tokens
  base.css             resets, focus, active press, utility classes

components/workspace/
  Workspace.tsx        shell, URL state, notes dialog wiring
  TopBar.tsx           wordmark, asset notes, theme toggle
  StagePanel.tsx       tabs, transport, camera controls, all stage states
  StageCanvas.tsx      React Three Fiber scene, model loading, camera rig
  GuidancePanel.tsx    demonstration copy, provenance, local completion
  AssetNotes.tsx       licence and inspection dialog

lib/
  assets.ts            exact asset metadata and supplied copy
  load-model.ts        GLTFLoader wrapper
  stage-palette.ts     resolves CSS tokens into Three.js colour values
  use-environment.ts   WebGL support and reduced-motion hooks
  use-demo-completion.ts
  theme.ts

public/assets/
  anatomy/             selected NIH 3D GLB
  movement/            trimmed Desk Break GLB and MIT notice
  fallback/            1200 × 900 stills captured from this build
```

## Assets and licences

Full details, hashes, rights and rejected candidates:
[`docs/3d-feasibility/asset-register.md`](docs/3d-feasibility/asset-register.md).

- **Anatomy:** NIH 3D `3DPX-000379` "Lumbar Spine - L4" by bgobbato, Public
  Domain. One L4 vertebra, not the full lumbar series.
- **Movement:** Desk Break `standing-cat-cow` by Shlomy Reshef, MIT. Trimmed
  from 435 clips to one with glTF Transform 4.5.1; clip unchanged. Full notice
  at `public/assets/movement/desk-break-LICENSE.txt`.
- **Fallback stills:** captures of those two approved models from this build.

No model with an unknown licence is shipped. No clinical claim, rep count or
dosage is shown, and the source's rep count is deliberately omitted.

## Verification

Run against the production build on 31 October 2026:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run build` | Pass (Next.js 16.4.3, Turbopack) |
| Browser script, 32 checks | 32/32 pass, 0 console errors |
| Hallmark `sloplint.mjs app --scope app --render` | Clean: 0 FAIL, 0 REFLEX, 0 WARN |

The browser script covers theme persistence, dialog Escape, play/pause, scrub,
speed, replay, text view, anatomy URL restore, camera presets, zoom, keyboard
tabs, completion persistence and clearing, mobile stacking, 320 px overflow,
reduced motion, GLB failure, and WebGL unavailable.

Screenshots in [`docs/screenshots/`](docs/screenshots/):

| File | View |
| --- | --- |
| `desktop-light.png` | Movement, light theme, 1440 × 900 |
| `desktop-dark.png` | Movement, dark theme, 1440 × 900 |
| `desktop-light-anatomy.png` | Anatomy, light theme |
| `desktop-static.png` | Text view with captured still |
| `desktop-failure.png` | Failed GLB request with recovery actions |
| `desktop-webgl-unavailable.png` | Static state when WebGL is unavailable |
| `mobile-light.png` | Movement, 390 px, stage above guidance |

## Known limits

- The anatomy file is a single L4 vertebra. It is not a lumbar series, a
  diagnostic model or a validated clinical asset.
- Camera labels "front", "side" and "back" follow exported file axes, not
  anatomical planes. The guidance rail says this.
- The movement clip is a demonstration of rigging and transport, not a
  prescription. The interface does not show reps or dosage.
- Still fallbacks are 2D captures, not a second interactive renderer.
- This is a standalone npm app. No auth, database, AI, upload, worker, payment
  or deployment configuration is included.

## Promotion

The proposed move into the pnpm `apps/web` workspace, including file mapping,
dependency merging, token collisions and a checklist, is in
[`docs/3d-feasibility/monorepo-promotion.md`](docs/3d-feasibility/monorepo-promotion.md).
No monorepo was created or modified for this spike.

The next smallest task after sign-off is to place `components/workspace` and
`lib/assets.ts` into `apps/web`, keep the host shell, and verify the same seven
states there. Do that before expanding the anatomy scope or adding a second
exercise.
