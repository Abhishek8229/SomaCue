# SomaCue — Stage 4.1 3D workspace

The Stage 4 feasibility prototype, promoted into the official pnpm monorepo
architecture without changing the interaction design or clinical copy.

**Status:** Stage 4.1 complete. The Next.js app lives in `apps/web`; the existing
routes, React Three Fiber stage, hooks, CSS, theme persistence and both GLB
assets are preserved.

## Workspace structure

```text
.
├─ apps/
│  └─ web/                 Next.js application
│     ├─ app/              routes, fonts, global tokens and theme script
│     ├─ components/       workspace UI and the R3F stage
│     ├─ lib/              asset metadata, model loading, hooks
│     └─ public/assets/    both GLBs, licence notice, fallback stills
├─ docs/
│  ├─ 3d-feasibility/      asset register, promotion/implementation notes
│  └─ screenshots/         verification captures
├─ scripts/
│  └─ verify-interactions.cjs
├─ package.json            root scripts and verification tooling
├─ pnpm-workspace.yaml
└─ pnpm-lock.yaml
```

Only one application exists today, so shared packages were not invented. The
workspace is ready for `packages/*` when a second consumer appears.

## Run it

Requires Node.js 20.9+ and pnpm 12.16.1. The root `packageManager` field pins the
pnpm version; Corepack is the simplest way to provide it.

```bash
corepack enable
pnpm install
pnpm dev          # http://localhost:3100
```

Production check:

```bash
pnpm build
pnpm start        # http://localhost:3100
```

Quality gates:

```bash
pnpm lint
pnpm typecheck
```

Browser interaction checks require the production server to be running:

```bash
pnpm start                         # terminal 1
pnpm verify:interactions           # terminal 2
```

The verification script finds Chrome in its standard Windows, macOS and Linux
locations. Override with `CHROME_PATH` if needed, or point at another server with
`SOMACUE_BASE_URL`.

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

## Application structure

```text
apps/web/
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
    StageCanvas.tsx      React Three Fiber scene, loading, camera rig
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

`TopBar` is retained because this repository still has no separate host shell.
Replacing it now would change the approved UI. See
[`docs/3d-feasibility/monorepo-implementation.md`](docs/3d-feasibility/monorepo-implementation.md)
for that and the other promotion decisions.

## Assets and licences

Full details, hashes, rights and rejected candidates:
[`docs/3d-feasibility/asset-register.md`](docs/3d-feasibility/asset-register.md).

- **Anatomy:** NIH 3D `3DPX-000379` "Lumbar Spine - L4" by bgobbato, Public
  Domain. One L4 vertebra, not the full lumbar series.
- **Movement:** Desk Break `standing-cat-cow` by Shlomy Reshef, MIT. Trimmed
  from 435 clips to one with glTF Transform 4.5.1; clip unchanged. Full notice
  at `apps/web/public/assets/movement/desk-break-LICENSE.txt`.
- **Fallback stills:** captures of those two approved models from this build.

No model with an unknown licence is shipped. No clinical claim, rep count or
dosage is shown, and the source's rep count is deliberately omitted.

## Verification

Run against the production build on 31 October 2026:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm build` | Pass (Next.js 16.4.3, Turbopack) |
| `pnpm verify:interactions` | **32/32 pass**, 0 console errors |

The browser script covers theme persistence, dialog Escape, play/pause, scrub,
speed, replay, text view, anatomy URL restore, camera presets, zoom, keyboard
tabs, completion persistence and clearing, mobile stacking, 320 px overflow,
reduced motion, GLB failure, and WebGL unavailable. The same 32 assertions from
Stage 4 were moved into `scripts/verify-interactions.cjs`; none were removed or
relaxed during the promotion.

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
- The workspace has no host application shell yet, so the local `TopBar` is
  still the header.
- No auth, database, AI, upload, worker, payment or deployment configuration is
  included.

## Git and further work

Git was initialized for Stage 4.1 and a checkpoint commit was created before
the refactor:

```text
56067af chore: checkpoint stage 4 standalone 3D prototype
```

The applied promotion record, dependency change and remaining integration
questions are in
[`docs/3d-feasibility/monorepo-implementation.md`](docs/3d-feasibility/monorepo-implementation.md).

The next smallest task is to connect `apps/web` to the host application shell
when that shell exists, keeping the current stage and guidance components. Do
not expand the anatomy catalogue or add another exercise yet.
