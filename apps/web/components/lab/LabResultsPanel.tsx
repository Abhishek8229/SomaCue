"use client";

import type { LabResults, PoseSample } from "@/lib/lab/lab-types";
import styles from "./Lab.module.css";

const fmt = (value: number, digits = 1) => value.toFixed(digits);
const fmtMeasured = (value: number | undefined, digits = 1) =>
  value === undefined ? "Not measured" : `${fmt(value, digits)}%`;

function SampleTable({ samples }: { samples: PoseSample[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">Containment and deformation by pose</caption>
        <thead>
          <tr>
            <th scope="col">Pose</th>
            <th scope="col" className="num">Bones inside skin</th>
            <th scope="col" className="num">Soft inside skin</th>
            <th scope="col" className="num">Edges over 25%</th>
            <th scope="col" className="num">Lowest skin</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((s) => (
            <tr key={s.label}>
              <th scope="row">{s.label}</th>
              <td className="num">{fmt(s.skeletalInsidePct)}%</td>
              <td className="num">{fmtMeasured(s.softInsidePct)}</td>
              <td className="num">{fmtMeasured(s.softEdgesOver25Pct, 2)}</td>
              <td className="num">{fmt(s.lowestSkinYmm, 0)} mm</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LabResultsPanel({ results }: { results: LabResults }) {
  const { verdict, checks, alignment, orientation, rest, motion } = results;
  return (
    <div className={styles.results}>
      <div
        className={`${styles.verdict} ${verdict.usableTogether ? styles.verdictPass : styles.verdictFail}`}
        role="status"
        data-testid="lab-verdict"
      >
        <p className={styles.verdictLabel}>
          {verdict.usableTogether ? "Compatible as tested" : "Not compatible as tested"}
        </p>
        <p className={styles.verdictCount}>
          {verdict.passed} of {checks.length} criteria passed
        </p>
        <p className={styles.verdictText}>{verdict.summary}</p>
      </div>

      <h3 className={styles.subhead}>Criteria</h3>
      <ul className={styles.checks} data-testid="lab-checks">
        {checks.map((check) => (
          <li key={check.id} className={styles.check} data-pass={check.pass}>
            <span className={styles.checkBadge}>{check.pass ? "Pass" : "Fail"}</span>
            <div>
              <p className={styles.checkLabel}>{check.label}</p>
              <p className={styles.checkValue}>{check.value}</p>
              <p className={styles.checkCriterion}>{check.criterion}</p>
              <p className={styles.checkCriterion}>Basis: {check.basis === "assets" ? "the assets" : "this lab's method"}</p>
            </div>
          </li>
        ))}
      </ul>

      <details className={styles.details}>
        <summary>Containment and deformation by pose</summary>
        <SampleTable
          samples={[
            rest,
            { ...results.heightMatchedFit, label: `Rest, height-matched scale ${results.heightMatchedFit.scale.toFixed(3)}` },
            ...motion.samples,
          ]}
        />
        <p className={styles.note}>
          Bones inside skin: share of 3,000 sampled skeleton vertices that fall inside the Innerscene
          skin (ray parity). Edges over 25%: share of sampled soft-tissue triangle edges stretched or
          squashed by more than a quarter against the matched rest pose. The height-matched row repeats the rest
          measurement with the atlas scaled to the rig height instead of the joint fit; it is a sensitivity check
          and has no soft-tissue measurement.
        </p>
      </details>

      <details className={styles.details}>
        <summary>Skeleton containment by region at rest</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Region</th>
                <th scope="col" className="num">Samples</th>
                <th scope="col" className="num">Inside skin</th>
              </tr>
            </thead>
            <tbody>
              {rest.regions.map((r) => (
                <tr key={r.region}>
                  <th scope="row">{r.region}</th>
                  <td className="num">{r.samples}</td>
                  <td className="num">{fmt(r.insidePct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className={styles.details}>
        <summary>Orientation</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Axis</th>
                <th scope="col" className="num">Atlas</th>
                <th scope="col" className="num">Rig</th>
                <th scope="col" className="num">Angle</th>
              </tr>
            </thead>
            <tbody>
              {orientation.axes.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.label}</th>
                  <td className="num">{a.atlas.map((x) => fmt(x, 2)).join(", ")}</td>
                  <td className="num">{a.rig.map((x) => fmt(x, 2)).join(", ")}</td>
                  <td className="num">{fmt(a.agreeDeg)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className={styles.details}>
        <summary>Segment lengths before fitting</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Segment</th>
                <th scope="col" className="num">Atlas</th>
                <th scope="col" className="num">Rig</th>
                <th scope="col" className="num">Scaled ratio</th>
              </tr>
            </thead>
            <tbody>
              {alignment.segments.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.label}</th>
                  <td className="num">{fmt(s.atlasM * 100, 1)} cm</td>
                  <td className="num">{fmt(s.rigM * 100, 1)} cm</td>
                  <td className="num">{fmt(s.ratio * alignment.fitScale, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Scaled ratio is the atlas length times the fitted scale ({fmt(alignment.fitScale, 3)}) divided
          by the rig length. 1.000 means the two bodies have the same proportion there.
        </p>
      </details>

      <details className={styles.details}>
        <summary>Joint landmarks after the best uniform fit</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Landmark</th>
                <th scope="col" className="num">Error</th>
              </tr>
            </thead>
            <tbody>
              {alignment.landmarks.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.label}</th>
                  <td className="num">{fmt(l.errorMm, 1)} mm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Arms were first posed to point where the atlas arms point (upper-arm abduction{" "}
          {fmt(alignment.matchedPose.armAbductionBeforeDeg, 0)}° in the file, {fmt(alignment.matchedPose.atlasArmAbductionDeg, 0)}° in the atlas,{" "}
          {fmt(alignment.matchedPose.armAbductionAfterDeg, 0)}° after matching). Atlas landmarks are
          estimated from bone geometry and carry roughly 5 to 15 mm of uncertainty.
        </p>
      </details>

      <details className={styles.details}>
        <summary>Run details</summary>
        <dl className={styles.facts}>
          <div><dt>Atlas</dt><dd>{results.atlas.parts.toLocaleString("en-GB")} structures, {results.atlas.triangles.toLocaleString("en-GB")} triangles, {fmt(results.atlas.heightM, 3)} m</dd></div>
          <div><dt>Rig</dt><dd>{results.rig.bones} bones, {results.rig.triangles.toLocaleString("en-GB")} body triangles, {fmt(results.rig.heightM, 3)} m</dd></div>
          <div><dt>Skinning</dt><dd>{results.skinning.rigidParts} rigid structures, {results.skinning.softVertices.toLocaleString("en-GB")} blended vertices</dd></div>
          <div><dt>Clip</dt><dd>{motion.clip}, {fmt(motion.durationS, 2)} s, {motion.sourceChannels} source tracks, {motion.bakedFrames} baked frames</dd></div>
          <div><dt>Timing</dt><dd>load {fmt(results.durationMs.load / 1000, 1)} s, build {fmt(results.durationMs.build / 1000, 1)} s, analysis {fmt(results.durationMs.analysis / 1000, 1)} s</dd></div>
        </dl>
      </details>
    </div>
  );
}
