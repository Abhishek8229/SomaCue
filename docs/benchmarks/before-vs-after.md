### Repository, tests and build

| Metric | Before (a500f2f) | After | Change |
|---|---:|---:|---:|
| Test files (Vitest) | 54 | 55 | +1 |
| Passing tests | 723 | 758 | +35 |
| `pnpm test` wall time | 24.02 s | 20.58 s | -3.4 s (-14.3%) |
| `pnpm typecheck` / `pnpm lint` | 6.37 s / 23.04 s | 4.11 s / 11.99 s | both clean |
| `pnpm verify:motion` | 18/18 | 18/18 | same |
| Tracked files (all) | 527 | 369 | -158 (-30.0%) |
| Source files (ts, tsx, css, sql, ...) | 391 | 289 | -102 (-26.1%) |
| Source lines of code | 62,420 | 51,816 | -10604 (-17.0%) |
|   of which production code | 52,390 | 41,339 | -11051 (-21.1%) |
|   of which tests | 10,030 | 10,477 | +447 (+4.5%) |
| `public/assets` footprint | 40.48 MB (28 files) | 37.56 MB (22 files) | -2.92 MB (-7.2%) |
| `public/` footprint (assets + models) | 41.7 MB | 38.78 MB | -2.92 MB (-7.0%) |
| Cold `next build` time | 23.21 s (re-run: 21.8 s) | 20.41 s | -2.8 s (-12.1%) |
|   compile / TypeScript phase | 7.3 s / 9.8 s | 7 s / 8.8 s |  |
| Static pages generated | 25 | 24 | -1 (-4.0%) |
| Client JS, all chunks (raw / gzip) | 2346.6 / 695 KB | 2339.6 / 692.5 KB | -7.0 KB (-0.3%) |
| Client CSS (raw / gzip) | 238.4 / 48.2 KB | 189.9 / 39.2 KB | -48.5 KB (-20.3%) |
| First-load JS /workspace (raw / gzip) | 1145.6 / 330.6 KB | 1145.5 / 330.7 KB | -0.1 KB (-0.0%) |
| First-load JS / (raw / gzip) | 590.7 / 183.9 KB | 583.7 / 181.3 KB | -7.0 KB (-1.2%) |
| First-load JS /dashboard (raw / gzip) | 647.5 / 193.6 KB | 647.5 / 193.6 KB | +0.0 KB (+0.0%) |

### HTTP latency and throughput (production servers, 1 request at a time for latency; 8 in flight for throughput)

| Endpoint | n | p50 ms | p95 ms | p99 ms | Throughput req/s |
|---|---:|---:|---:|---:|---:|
| / (landing page) | 200 | 7.04 → 6.84 | 9.52 → 9.25 | 11.52 → 12.4 | 199.71 → 199.71 |
| /login | 200 | 4.15 → 3.78 | 5.83 → 5.09 | 9.77 → 8.2 | 342.58 → 336.09 |
| /pricing | 200 | 4.12 → 4.01 | 5.39 → 6.07 | 7.67 → 8.45 | 310.24 → 302.48 |
| /3d-lab | 200 | 3.82 → 4.36 | 5.11 → 5.86 | 7.98 → 7.35 | 354.97 → 316.29 |
| largest JS chunk | 200 | 14.43 → 14.54 | 16.22 → 16.59 | 18.26 → 18.2 | 315.38 → 321.02 |
| /models/athlete-male.glb (1 MB) | 100 | 29.09 → 28.94 | 31.87 → 31.18 | 33.49 → 32.39 | 148.18 → 149.4 |
| /dashboard (signed in, DB) | 60 | 373.34 → 329.48 | 668.24 → 412.36 | 969.3 → 1088.32 | 8.93 → 8.94 |
| /workspace (signed in, DB) | 60 | 320.9 → 358.69 | 419.72 → 380.31 | 1499.84 → 1747.25 | 10.88 → 10.87 |
| /api/billing/status (DB) | 60 | 105.5 → 104.62 | 115.41 → 118.38 | 736.3 → 124.63 | 28.87 → 30.53 |
| /api/chat history (DB) | 60 | 319.44 → 326.18 | 342.26 → 742.97 | 1506.34 → 1600.7 | 19.36 → 16.39 |
| /api/recovery/export (DB) | 60 | 320.04 → 200.3 | 515.25 → 254.8 | 808.54 → 834.25 | 16.77 → 17.6 |

### In-process benchmarks (10 warm-up + 100 timed; p50 ms)

| Benchmark | Before | After | Change |
|---|---:|---:|---:|
| kinematics: body load, cold (read + parse + rig) | 8.6321 | 7.5647 | -12.4% |
| kinematics: loadBodyRigNode, warm (clone + rig) | 4.8092 | 4.4613 | -7.2% |
| kinematics: validateMovement: Glute Bridge (12 samples) | 117.4736 | 106.3029 | -9.5% |
| kinematics: validateMovement: Cat-Cow (12 samples) | 59.3435 | 54.669 | -7.9% |
| kinematics: validateMovement: Seated Chin Tuck (12 samples) | 52.8736 | 47.2892 | -10.6% |
| kinematics: validateMovement: Mini Squat (12 samples) | 49.8101 | 44.0881 | -11.5% |
| kinematics: validateMovement: all 18 reference exercises | 1861.0467 | 1628.8905 | -12.5% |
| kinematics: solvePose: Glute Bridge, mid-movement | 3.9228 | 3.722 | -5.1% |
| kinematics: MotionEngine.update (one 60 fps frame) | 3.8542 | 3.6965 | -4.1% |
| kinematics: parseMovementSpec + normalizeSpec | 0.023 | 0.0216 | -6.1% |
| kinematics: repairPlan: 3 steps + 2 scheduled days | 0.18 | 0.1709 | -5.1% |
| precautions: buildDynamicItems (pain + feedback + missed) | 0.0136 | 0.0085 | -37.5% |
| precautions: createDynamicPrecautions | 0.0235 | 0.0107 | -54.5% |
| precautions: normalizePrecautions (8 raw bullets) | 0.0035 | 0.0022 | -37.1% |
| precautions: parseDynamicPrecautions (stored JSON) | 0.005 | 0.0031 | -38.0% |
| precautions: initialPrecautions (AI response) | 0.0088 | 0.0043 | -51.1% |
| timeline: deriveRecoveryEvents (fixture) | 1.2206 | 0.6478 | -46.9% |
| timeline: mergeRecoveryEvents (fixture) | 0.1615 | 0.1526 | -5.5% |
| timeline: summarizeTrends (fixture) | 0.0165 | 0.0108 | -34.5% |
| timeline: derive + merge + trends (aggregation) | 0.9289 | 0.8587 | -7.6% |
| timeline: renderRecoveryReport (HTML export) | 0.7981 | 0.7656 | -4.1% |
| timeline: extractChatInsight: short symptom message | 0.0039 | 0.0023 | -41.0% |
| timeline: extractChatInsight: long message (~2.6k chars) | 0.077 | 0.0745 | -3.2% |
| timeline: extractChatInsight: casual message | 0.0016 | 0.001 | -37.5% |
| prisma: SELECT 1 (network round trip) | 116.8249 | 83.3619 | -28.6% |
| prisma: getDashboardSnapshot | 319.4076 | 381.9942 | +19.6% |
| prisma: getRecoveryTimeline | 178.945 | 299.2689 | +67.2% |
| prisma: workspace page: latest report with relations | 216.2715 | 214.6193 | -0.8% |
| prisma: getBillingStatus | 101.3448 | 95.0223 | -6.2% |
| prisma: getUserPlan | 100.3137 | 91.9075 | -8.4% |
| prisma: getCompanionAllowance | 100.3344 | 92.1986 | -8.1% |
| prisma: loadChatContext | 230.626 | 189.584 | -17.8% |

19 of 32 in-process benchmarks are within ±15% on p50.
