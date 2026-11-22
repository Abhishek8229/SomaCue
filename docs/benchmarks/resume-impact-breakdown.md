# SomaCue engineering audit: change-to-impact breakdown

|  |  |
| --- | --- |
| **Before** | commit `a500f2f` (clean tree) |
| **After** | `` (the audit fixes and dead-code removal; replace with the commit hash once committed) |
| **Machine** | Windows, AMD Ryzen 7 5800H (16 logical cores, 15.4 GB), Node v24.13.1, pnpm 12.16.1 |
| **Stack** | Next.js 16.4.6 (Turbopack), React 19, TypeScript 5.9, Prisma 7, PostgreSQL on Neon, Vitest 5 |
| **Raw data** | [`baseline-before.json`](baseline-before.json), [`baseline-after.json`](baseline-after.json), [`before-vs-after.md`](before-vs-after.md) |

Every number below comes from those files or from `git diff` against `a500f2f`. Where a number is noise, or a claim was
checked only in a limited way, the text says so.

## 1. Measured results

### Repository and tests

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Test files (Vitest) | 54 | 55 | +1 |
| Passing tests | 723 | 758 | **+35** (+4.8%) |
| Tracked files | 527 | 369 | **−158** (−30.0%) |
| Source files (ts, tsx, css, sql, …) | 391 | 289 | −102 (−26.1%) |
| Source lines | 62,420 | 51,816 | **−10,604** (−17.0%) |
| – production code | 52,390 | 41,339 | −11,051 (−21.1%) |
| – tests | 10,030 | 10,477 | +447 (+4.5%) |
| `public/assets` | 40.48 MB (28 files) | 37.56 MB (22 files) | **−2.92 MB** (−7.2%) |

The line and file changes are **net**. The diff against `a500f2f` deletes 161 tracked files and 12,228 lines, and adds 482
lines plus 3 new files (a migration and two test files).

### Build and bundle

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Cold `next build`, same-method re-run of the old commit in a worktree | 21.8 s | 20.41 s | −1.4 s (about −6%) |
| Cold `next build`, first baseline run | 23.21 s | 20.41 s | see note |
| TypeScript phase of the build | 9.8 s | 8.8 s | −1.0 s |
| Static pages generated | 25 | 24 | −1 |
| Client CSS, raw / gzip | 238.4 / 48.2 KB | 189.9 / 39.2 KB | **−48.5 / −9.0 KB** (−20.3% / −18.7%) |
| Client JS, raw / gzip | 2,346.6 / 695.0 KB | 2,339.6 / 692.5 KB | −7.0 / −2.5 KB (−0.3%) |
| First-load JS, `/` (raw) | 590.7 KB | 583.7 KB | −7.0 KB |
| First-load JS, `/workspace` and `/dashboard` (raw) | 1,145.6 / 647.5 KB | 1,145.5 / 647.5 KB | unchanged |

Note on timings. The 23.21 s and the other "before" gate timings (typecheck 6.37 s, lint 23.04 s, `pnpm test` 24.02 s) were
taken on a busier machine than the "after" ones (4.11 s, 11.99 s, 20.58 s). Lint dropped far more than a 17% smaller codebase
explains, so **do not credit those gate-time drops to the cleanup**. The fair build comparison is the same-method re-run:
about 6% faster, which is within what run-to-run variation allows. The honest claim is "no build regression".

### Gates (all pass before and after)

| Gate | Before | After |
| --- | --- | --- |
| `pnpm typecheck` / `pnpm lint` | clean | clean |
| `pnpm test` | 54 files, 723 tests | 55 files, 758 tests |
| `pnpm verify:motion` | 18/18 exercises | 18/18 exercises |
| `pnpm verify:lab-first-frame` (browser) | 10/10 | 10/10 |

### HTTP latency and throughput

Production servers side by side: `a500f2f` built in a git worktree on port 3101 and the working tree on port 3100. Only one
server was under load at a time. The sides took turns in 2 rounds with samples pooled. Latency is one request at a time with the
body fully read, after 10 warm-up requests per side; throughput is 8 requests in flight for 3 s per block. Signed-in routes used a
session cookie for an existing account, and every request returned 200. Cells are Before → After.

| Endpoint | n | p50 ms | p95 ms | p99 ms | req/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 200 | 7.04 → 6.84 | 9.52 → 9.25 | 11.52 → 12.4 | 199.71 → 199.71 |
| `/login` | 200 | 4.15 → 3.78 | 5.83 → 5.09 | 9.77 → 8.2 | 342.58 → 336.09 |
| `/pricing` | 200 | 4.12 → 4.01 | 5.39 → 6.07 | 7.67 → 8.45 | 310.24 → 302.48 |
| `/3d-lab` | 200 | 3.82 → 4.36 | 5.11 → 5.86 | 7.98 → 7.35 | 354.97 → 316.29 |
| Largest JS chunk | 200 | 14.43 → 14.54 | 16.22 → 16.59 | 18.26 → 18.2 | 315.38 → 321.02 |
| `/models/athlete-male.glb` (1 MB) | 100 | 29.09 → 28.94 | 31.87 → 31.18 | 33.49 → 32.39 | 148.18 → 149.4 |
| `/dashboard` (signed in, DB) | 60 | 373.34 → 329.48 | 668.24 → 412.36 | 969.3 → 1088.32 | 8.93 → 8.94 |
| `/workspace` (signed in, DB) | 60 | 320.9 → 358.69 | 419.72 → 380.31 | 1499.84 → 1747.25 | 10.88 → 10.87 |
| `/api/billing/status` (DB) | 60 | 105.5 → 104.62 | 115.41 → 118.38 | 736.3 → 124.63 | 28.87 → 30.53 |
| `/api/chat` history (DB) | 60 | 319.44 → 326.18 | 342.26 → 742.97 | 1506.34 → 1600.7 | 19.36 → 16.39 |
| `/api/recovery/export` (DB) | 60 | 320.04 → 200.3 | 515.25 → 254.8 | 808.54 → 834.25 | 16.77 → 17.6 |

How to read it: **no difference distinguishable from noise.** Static and server-rendered pages stay under 10 ms at p50.
Database-backed routes are dominated by the round trip to the remote database, which drifted between runs (a plain `SELECT 1`
measured 117 ms in one run and 83 ms in the other). Some rows look worse (`/workspace` p50, `/api/chat` p95, `/3d-lab`
throughput) and some look better (`/api/recovery/export` p50). With 60 samples per database route, all of that is noise, and none of it
should be presented as a gain or a regression. The p99 of a 60-sample set is essentially its maximum.
The one real behavioural change is `POST /api/extract`: `401` before, `404` after.

### In-process benchmarks

32 benchmarks (kinematics solver, dynamic precautions, Recovery Timeline aggregation and export, read-only Prisma queries),
10 warm-up and 100 timed iterations each, in `baseline-before.json` and `baseline-after.json`. 19 of 32 are within ±15% on p50 and
the rest moved with no code change behind them: the "before" run was colder, and the Prisma rows follow the database round-trip
drift. Treat this set as a **regression guard (nothing got slower for a reason), not as a speed-up**. The full table is in
[`before-vs-after.md`](before-vs-after.md).

## 2. What changed and why it matters

### Removed code and assets

| Change | Size | Effect |
| --- | --- | --- |
| Unused `landing/kit` (131 of 155 files, including 44 third-party brand SVGs and their licence files) | 82 ts/tsx/css files, 6,408 lines | **The only source of the CSS drop** (see below) |
| Legacy stage UI: `Workspace`, `TopBar`, `StagePanel`, `GuidancePanel`, `AssetNotes`, `StageCanvas` and their CSS | 11 files, 2,803 lines | Nothing user-visible; not reachable from any route |
| Orphaned `lib/assets`, `use-demo-completion`, `stage-types`, `theme`, `format` | 5 files, 273 lines | Smaller surface to maintain |
| `PatientIntake` component and CSS | 2 files, 895 lines | Live intake is `SidebarIntake` |
| `build-soma-body.mjs` and `soma-body.glb` | 547 lines, 0.47 MB | `pnpm build:body` now points at `scripts/athlete-male/build.cjs` |
| `public/assets/{anatomy,movement,fallback}` | 5 files, 2.45 MB | Nothing referenced them |
| `lib/ai/extractor.ts` and its test, `lib/safety/engine.ts` | 49 and 181 lines | Only the removed `/api/extract` used them |
| `/api/extract` route | 35 lines | Closed a signed-in but unmetered LLM endpoint with no callers |
| Duplicate `apps/web/.env.example`, `verify:auth` script entry, 77-line AWS block in `AGENTS.md` | – | Single source of truth, no dead script, project file free of unrelated rules |

Why the CSS dropped, precisely. `HeroStage` imported the kit through its barrel file, which loaded every kit stylesheet. Switching
to direct imports and deleting the rest removed that CSS. The `Workspace` and `PatientIntake` CSS was never reachable from the app,
so it did not change the bundle. The landing page renders **byte-identically** before and after (reduced-motion screenshots at 1440 and 390 px),
and the stylesheet rule count fell from 576 to 537.

### Bugs and risks fixed

| # | Fix | How it was checked |
| --- | --- | --- |
| 1 | **Pain Override veto now covers the mirrored side.** `loadedRegions()` adds the opposite side of every left/right region when an exercise alternates. | 7 tests in `painEvent.test.ts`: left-tagged exercise vetoed by right-side pain and the reverse, Bird Dog, non-alternating stays one-sided, today untouched |
| 2 | **Empty-database deploy.** Added `20261113090000_add_triage_and_treatment_plan` (guarded, safe to re-run) to create `TriageQuiz`, `QuizAnswer` and `TreatmentPlan` before the precautions migration needs them. | All migrations applied to an **empty scratch schema** in the Neon database; `prisma migrate diff` against `schema.prisma` showed no drift; the new migration re-ran twice cleanly. 6 tests in `migrations.test.ts` |
| 3 | **Voice dictation fills the symptoms box** without overwriting typing or repeating text. | 6 component tests with a mocked speech hook. Not tried in a real browser, whose support for speech recognition varies |
| 4 | **`completeTriageQuiz` replay.** A report that already has a plan needs the re-analysis entitlement, checked before answers are saved or the AI is called, and fails closed. A Pro re-run keeps the plan's creation time and Day 1. | 6 new tests in `intakeAction.test.ts`; one `precautionsPersistence` test updated (it used to expect the reset) |
| 5 | **Red-flag chat messages skip the upgrade prompt** when the Free allowance is over, so the server's urgent-care reply is reached. | 3 tests in `chatDrawer.test.tsx`. Only messages the keyword screen catches are covered |
| 6 | **Concurrent purchases stack.** The webhook and verify routes grant days in a Serializable transaction with up to 6 retries on `P2034`. | 8 tests in `billingWebhook.test.ts` (2 and 3 simultaneous purchases give 30 + 60 days and 180 days, a double delivery grants once, giving up returns 500 so Razorpay retries) plus 1 in `billingRoutes.test.ts`. Simulated conflicts, **not run against live Postgres** |
| 7 | **`/api/extract` removed.** | `POST` went `401` → `404`; build generates 24 static pages instead of 25 |
| 8–9 | Dead stage UI and kit pruned (table above) | Typecheck, lint, tests, cold build and identical landing screenshots |
| 10 | `encryptSession` / `decryptSession` wrappers replaced by `signSession` / `verifySession` | `auth.test.ts` |
| 11–15 | Duplicate `.env.example`, retired body pipeline, `PatientIntake`, `verify:auth`, `AGENTS.md` clean-up | Typecheck, lint, tests |

Net test change: +38 tests added, −3 removed with the extractor, so **+35**.

## 3. Resume bullets (each backed by the data above)

- **Security and concurrency fixes:** Audited a 62k-line Next.js, TypeScript and Prisma rehabilitation app and fixed 15 findings. Granted Razorpay purchases inside serializable Prisma transactions with bounded retries on `P2034`, so simultaneous payments stack every day (tested with simulated conflicts). Gated plan replays behind the re-analysis entitlement and removed an unused, unmetered LLM endpoint.
- **Clinical safety and reliability:** Extended the Pain Override exercise veto to the mirrored side of alternating exercises, kept urgent-care replies reachable for red-flag messages after the free chat quota ends, and repaired the migration history so `prisma migrate deploy` works on an empty schema with no drift.
- **Codebase and build hygiene:** Removed 158 net tracked files (−30%) and 10.6k net source lines (−17%), cut client CSS by 20% (238.4 → 189.9 KB) and `public/assets` by 2.9 MB, kept the cold build at about 20 s with no runtime latency change across 11 endpoints, and grew the Vitest suite from 723 to 758 passing tests.

## 4. Caveats

- "After" is the uncommitted working tree at the time of measurement. Replace `` in the table above with the commit hash.
- Timings were measured on one Windows machine against a remote Neon database. Treat database-backed latency as network-dominated.
- The benchmark and collection scripts that produced these files lived in a scratch folder and were deleted after the run. The JSON files keep the methodology, environment and every raw sample.
