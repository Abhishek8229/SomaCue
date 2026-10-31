# Promotion note: standalone spike → `apps/web`

> **Status:** applied in Stage 4.1 on 31 October 2026. The authoritative
> structure, actual file mapping, dependency notes and deviations are recorded
> in [`monorepo-implementation.md`](monorepo-implementation.md). This note is
> retained as the original promotion plan.

This note records how the Stage 4 prototype would move into the approved pnpm
monorepo. At the time of writing, the working directory had no monorepo, no
workspace file and no pnpm installation; a standalone npm app was the smallest
way to run the spike.

## Target shape

```
apps/
  web/
    app/(demo)/3d-feasibility/...
    components/workspace/...
    lib/...
    public/assets/...
```

Keep the existing host app shell and navigation. The prototype's `TopBar` is a
local device, not a product header; the host should provide the wordmark,
account controls and theme control. The stage and guidance panel can move
largely unchanged.

## File mapping

| Prototype | Destination | Change on move |
| --- | --- | --- |
| `app/layout.tsx` | route-level layout or host root layout | Move font variables to the host layout; do not create a second `<html>` |
| `app/page.tsx` | `app/(demo)/3d-feasibility/page.tsx` | Keep `searchParams` handling for `?view=anatomy` |
| `app/tokens.css` | shared theme package or host tokens | Rename `--stage-*` only if the host already owns those names; resolve collisions first |
| `app/base.css` | host global styles or route-level CSS | Merge resets/focus rules; avoid duplicate `:focus-visible` overrides |
| `app/globals.css` | host global stylesheet | Move the Hallmark stamp only if the host uses Hallmark; it describes this screen |
| `components/workspace/*` | `apps/web/components/workspace/*` | Keep CSS Modules; replace `TopBar` with host chrome |
| `lib/assets.ts` | `apps/web/lib/3d-assets.ts` or content package | Single source for paths, licences and supplied copy |
| `lib/load-model.ts` | co-locate with the stage | No change |
| `lib/stage-palette.ts` | co-locate with the stage | No change; still reads CSS tokens at runtime |
| `lib/use-environment.ts` | co-locate with the stage | No change |
| `lib/theme.ts` | host theme utilities | Do not ship two theme controllers |
| `lib/use-demo-completion.ts` | co-locate or replace with host progress | Keep `somacue.*` keys until a migration exists |
| `public/assets/anatomy/*` | `apps/web/public/assets/3d/anatomy/*` | Update `lib/assets.ts` paths in one place |
| `public/assets/movement/*` | `apps/web/public/assets/3d/movement/*` | Keep the MIT notice beside the GLB |
| `public/assets/fallback/*` | `apps/web/public/assets/3d/fallback/*` | Regenerate only if the host stage changes materially |
| `docs/3d-feasibility/*` | `docs/3d-feasibility/*` | Keep the asset register with the product docs |

## Dependencies

Merge these exact ranges into `apps/web/package.json`; do not copy
`package-lock.json` into the pnpm workspace.

```json
{
  "@react-three/drei": "10.7.9",
  "@react-three/fiber": "9.8.2",
  "three": "0.187.0"
}
```

Next.js, React and React DOM should follow the host app's existing versions if
they are compatible with R3F 9 and Drei 10. Check for a duplicate `three`
install after the merge; two copies produce confusing loader and scene errors.
`puppeteer-core` is a test-only dependency and should live with the
verification tooling, not the app.

## Behaviour to preserve

- Stage first in the DOM, guidance second; mobile stacks stage above guidance.
- 35/65 split on desktop, with no horizontal overflow at 1440, 390 and 320 px.
- The stage is dark in both themes. Stage tokens stay static.
- First visit follows `prefers-color-scheme`; a manual choice persists.
- Movement starts paused. Speed changes playback only, never dosage.
- All four states remain reachable and honest: loading, failure, WebGL
  unavailable, static/text fallback.
- Focus remains visible, tabs support arrow keys, and reduced motion is
  respected.
- Completion stays local and is labelled as such.
- No invented reps, dose or clinical claim enters the supplied copy.

## Promotion checklist

1. Confirm the host route and whether the demo lives at `/3d-feasibility`.
2. Merge dependencies and run `pnpm install`; verify one `three` version.
3. Move assets and update `lib/assets.ts` paths and licence links.
4. Replace `TopBar` with host chrome; keep asset notes reachable.
5. Reconcile theme ownership and `--color-*` / `--stage-*` token collisions.
6. Run `pnpm lint`, `pnpm typecheck` and `pnpm build` in the workspace.
7. Re-run the seven-state browser checks and capture new screenshots.
8. Re-run Hallmark `sloplint` at app scope.
9. Remove the standalone prototype only after the host route is signed off.

## Open integration questions

- Does the host already own a 3D route or a shared R3F canvas?
- Are assets served from `public/` or a CDN? If a CDN, the fallback images and
  licence notice must move with the GLBs.
- Should the host theme controller own `somacue.theme`, or should the demo
  consume the host theme without writing storage?
- Is the guidance copy supplied by a content service later, or does it remain
  a typed constant? Keep the current typed source until that is decided.

## Smallest next task

Copy `components/workspace/*`, `lib/assets.ts` and the two GLBs into
`apps/web`, point the route at the host shell, and verify the same 32 browser
checks there. Do not expand anatomy scope or add a second clip before that
passes.
