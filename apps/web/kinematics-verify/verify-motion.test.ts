// @vitest-environment node
/**
 * verify:motion — solves every reference exercise (both sides when it
 * alternates) on the real body and checks it against MOTION_THRESHOLDS.
 * Writes docs/3d-engine/motion-report.json. Run with `pnpm verify:motion`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadBodyRigNode } from "@/lib/kinematics/node-body";
import { REFERENCE_EXERCISES } from "@/lib/kinematics/reference-exercises";
import { MOTION_THRESHOLDS, validateMovement } from "@/lib/kinematics/validate";
import { CLINICAL_RANGES_REVIEWED } from "@/lib/kinematics/joint-table";

it("every reference exercise passes the motion thresholds", async () => {
  const rig = await loadBodyRigNode();
  const started = performance.now();
  const rows = REFERENCE_EXERCISES.map((exercise) => {
    const t0 = performance.now();
    const report = validateMovement(rig, exercise.spec, 12);
    return {
      id: exercise.id,
      posture: exercise.spec.posture,
      ok: report.ok,
      minClearanceMm: Number(report.metrics.minClearanceMm.toFixed(1)),
      maxPinSlipMm: Number(report.metrics.maxPinSlipMm.toFixed(1)),
      maxOverlapMm: Number(report.metrics.maxOverlapMm.toFixed(1)),
      safeProgress: report.metrics.safeProgress,
      finite: report.metrics.finite,
      solveMs: Number((performance.now() - t0).toFixed(1)),
      issues: report.issues,
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    rig: {
      bones: rig.mesh.skeleton.bones.length,
      vertices: rig.mesh.geometry.attributes.position.count,
      triangles: (rig.mesh.geometry.index?.count ?? 0) / 3,
      standingHeightM: Number(rig.standingHeight.toFixed(3)),
      sampledVertices: rig.sampler.indices.length,
    },
    thresholds: MOTION_THRESHOLDS,
    clinicalRangesReviewed: CLINICAL_RANGES_REVIEWED,
    totalMs: Number((performance.now() - started).toFixed(0)),
    passed: rows.filter((row) => row.ok).length,
    failed: rows.filter((row) => !row.ok).length,
    exercises: rows,
  };

  console.table(
    rows.map(({ id, posture, ok, minClearanceMm, maxPinSlipMm, maxOverlapMm, safeProgress, solveMs }) => ({
      id,
      posture,
      ok,
      "floor mm": minClearanceMm,
      "slip mm": maxPinSlipMm,
      "overlap mm": maxOverlapMm,
      "safe %": Math.round(safeProgress * 100),
      ms: solveMs,
    })),
  );
  const out = join(process.cwd(), "..", "..", "docs", "3d-engine", "motion-report.json");
  writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`verify:motion ${summary.passed}/${rows.length} passed in ${summary.totalMs} ms. Report: docs/3d-engine/motion-report.json`);

  for (const row of rows) expect(row.issues, row.id).toEqual([]);
}, 120_000);
