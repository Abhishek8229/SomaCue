# Monorepo implementation record — Stage 4.1

Applied 31 October 2026. This replaces the speculative parts of
[`monorepo-promotion.md`](monorepo-promotion.md) with the structure that is
actually in the repository.

## Outcome

The Stage 4 Next.js prototype now lives in a pnpm workspace at `apps/web`.
Behaviour, routes, copy, visual design and assets are unchanged. The workspace
was created with the smallest structure that supports the current product:

```text
.
├─ apps/
│  └─ web/
│     ├─ app/
│     ├─ components/workspace/
│     ├─ lib/
│     ├─ public/assets/
│     ├─ eslint.config.mjs
│     ├─ next.config.ts
│     ├─ package.json
│     └─ tsconfig.json
├─ docs/
├─ scripts/verify-interactions.cjs
├─ package.json
├─ pnpm-lock.yaml
└─ pnpm-workspace.yaml
```

No `packages/*` were created. There is one application and no second consumer
for a shared UI, content or config package. Extracting packages before a real
consumer exists would add indirection without reducing duplication.

## Workspace ownership

| Concern | Owner |
| --- | --- |
| pnpm workspace definition | root `pnpm-workspace.yaml` |
| pnpm version | root `packageManager`: `pnpm@12.16.1` |
| Cross-workspace scripts | root `package.json` |
| Browser verification | root `scripts/verify-interactions.cjs` + root `puppeteer-core` |
| Next.js application | `apps/web` |
| Product documentation and screenshots | root `docs/` |
| 3D assets and licences | `apps/web/public/assets/` |

Root scripts delegate with `pnpm --filter @somacue/web`, so contributors run one
command from the repository root.

## File mapping applied

| Stage 4 path | Stage 4.1 path |
| --- | --- |
| `app/` | `apps/web/app/` |
| `components/workspace/` | `apps/web/components/workspace/` |
| `lib/` | `apps/web/lib/` |
| `public/assets/` | `apps/web/public/assets/` |
| `next.config.ts` | `apps/web/next.config.ts` |
| `tsconfig.json` | `apps/web/tsconfig.json` |
| `eslint.config.mjs` | `apps/web/eslint.config.mjs` |
| `package.json` app fields | `apps/web/package.json` |
| root `package.json` | workspace orchestration and verification tooling |
| `package-lock.json` | removed; `pnpm-lock.yaml` is the lockfile |
| external verification script | `scripts/verify-interactions.cjs` |

The move used `git mv`, so file history is preserved in the checkpoint-to-
promotion diff. No component was recreated and no asset was downloaded again.

## Deliberate deviations from the proposal

### Route stays at `/`

The promotion note suggested `app/(demo)/3d-feasibility/page.tsx`. The existing
route is `/`, with `/?view=anatomy`. Moving it would break the approved route
and require rewriting the 32 interaction checks. The requirement was to promote
the app, not to re-route it. A future host application can mount the workspace
at `/3d-feasibility` without changing the components.

### `TopBar` stays

There is no host application shell in this repository. The proposal said to
replace `TopBar` with host chrome, but doing so would change the approved UI and
remove the only theme and asset-notes entry points. `TopBar` remains until a
real host shell exists; the swap is a shell integration task, not a workspace
move.

### App-local `lib`, not a shared package

`lib/assets.ts`, the R3F hooks and the palette resolver have one consumer. They
stay in `apps/web/lib` until a second app or a content service needs them.

### Assets stay under the app's public root

The source paths remain `/assets/anatomy/...`, `/assets/movement/...` and
`/assets/fallback/...`. Physically they moved with the app to
`apps/web/public/assets/`. This keeps Next.js public-file semantics and avoids a
second path-rewriting layer.

## Dependency changes

| Change | Reason |
| --- | --- |
| `package-lock.json` removed; `pnpm-lock.yaml` added | One workspace lockfile |
| `puppeteer-core` moved to root devDependencies | Verification tooling is not application runtime |
| `three-stdlib@2.36.1` added directly to `apps/web` | `StageCanvas.tsx` imports its `OrbitControls` type; npm's flat `node_modules` hid this transitive dependency, pnpm's strict layout correctly exposed it |
| `pnpm@12.16.1` pinned in root `packageManager` | Reproducible workspace tooling |

No application dependency was upgraded. The installed tree is one `three`
version and one `three-stdlib` version:

```text
three@0.187.0
three-stdlib@2.36.1
```

pnpm 12 required an explicit build approval for `unrs-resolver`, the native
resolver used by the ESLint stack. The approval is recorded in
`pnpm-workspace.yaml` as `allowBuilds: unrs-resolver: true`. This is tooling,
not application code.

## Verification after promotion

Run from the repository root against the production server:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm build` | Pass |
| `pnpm verify:interactions` | 32/32 pass, 0 console errors |

The verification script is the same 32 assertions used in Stage 4. It now
resolves Chrome portably, accepts `CHROME_PATH` and `SOMACUE_BASE_URL`, writes
screenshots to `docs/screenshots/`, and runs from the root lockfile. No assertion
was weakened, removed or skipped.

The production build was checked at 1440 × 900 and the script exercised 390 px
and 320 px layouts, light and dark themes, reduced motion, model failure and
WebGL unavailability. Screenshots were regenerated after the move.

## Git checkpoint

Git was initialized in `D:\SomaCue` after checking `.gitignore` and scanning the
working tree for environment files and common secret patterns. No secrets were
found. The checkpoint commit before any refactoring was:

```text
56067af chore: checkpoint stage 4 standalone 3D prototype
```

The promotion is a separate commit after that checkpoint.

## Remaining blockers

- No host application shell exists yet. `TopBar`, theme ownership and route
  mounting remain app-local until it does.
- No shared content service or design-system package exists, so guidance copy
  remains a typed constant in `apps/web/lib/assets.ts`.
- Asset hosting is local `public/`; a CDN decision is deferred.
- The anatomy asset remains one L4 vertebra. That is a known scope limit, not a
  promotion defect.

## Smallest next task

When the host shell is available, mount the workspace at its agreed route and
replace `TopBar` with host chrome while keeping the stage, guidance panel and
theme storage contract. Re-run `pnpm verify:interactions` at the new URL with
`SOMACUE_BASE_URL`. Do not expand the catalogue or add a second exercise before
that integration passes.
