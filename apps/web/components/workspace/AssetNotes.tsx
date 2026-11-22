"use client";

import { useEffect, useRef } from "react";
import { anatomy, movement } from "@/lib/assets";
import { formatBytes, formatBytesExact, formatCount } from "@/lib/format";
import styles from "./AssetNotes.module.css";

type AssetNotesProps = {
  open: boolean;
  onClose: () => void;
};

export function AssetNotes({ open, onClose }: AssetNotesProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="asset-notes-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.head}>
          <h2 id="asset-notes-title">Asset notes</h2>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.intro}>
            Files, licences and inspection results for the two models behind this
            prototype. Both files are served locally.
          </p>

          <section className={styles.section} aria-labelledby="notes-movement">
            <h3 id="notes-movement">{movement.title}</h3>
            <dl className={styles.rows}>
              <div>
                <dt>Source</dt>
                <dd>
                  <a href={movement.provenance.sourceUrl} target="_blank" rel="noreferrer">
                    {movement.provenance.sourceName}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>{" "}
                  by {movement.provenance.creator}
                </dd>
              </div>
              <div>
                <dt>Licence</dt>
                <dd>
                  <a
                    href={movement.provenance.licence.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {movement.provenance.licence.name}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                  . {movement.provenance.licence.summary}
                </dd>
              </div>
              <div>
                <dt>File</dt>
                <dd>
                  <code>{movement.asset.path.replace("/assets/", "")}</code>
                  <span className={styles.measure}>
                    {movement.asset.format}, {formatBytes(movement.asset.bytes)} (
                    {formatBytesExact(movement.asset.bytes)})
                  </span>
                </dd>
              </div>
              <div>
                <dt>Clip</dt>
                <dd>
                  <code>{movement.clip.name}</code>
                  <span className={styles.measure}>
                    2.83 s, {movement.clip.joints} joints, {movement.clip.channels}{" "}
                    channels, one clip
                  </span>
                </dd>
              </div>
              <div>
                <dt>Edit</dt>
                <dd>
                  {movement.sourceTrim.originalClips - movement.sourceTrim.retainedClips}{" "}
                  of {movement.sourceTrim.originalClips} clips and 7,716 unused accessors
                  removed with {movement.sourceTrim.tool}. The selected clip is
                  unchanged.
                </dd>
              </div>
              <div>
                <dt>Notice</dt>
                <dd>
                  The full MIT text travels with the file at{" "}
                  <code>assets/movement/desk-break-LICENSE.txt</code>.
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="notes-anatomy">
            <h3 id="notes-anatomy">{anatomy.title}</h3>
            <dl className={styles.rows}>
              <div>
                <dt>Source</dt>
                <dd>
                  <a href={anatomy.provenance.sourceUrl} target="_blank" rel="noreferrer">
                    {anatomy.provenance.sourceName}{" "}
                    {anatomy.provenance.entryId}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>{" "}
                  by {anatomy.provenance.creator}, version {anatomy.version.number},
                  published {anatomy.version.published}
                </dd>
              </div>
              <div>
                <dt>Licence</dt>
                <dd>
                  {anatomy.provenance.licence.name}.{" "}
                  {anatomy.provenance.licence.summary}
                </dd>
              </div>
              <div>
                <dt>File</dt>
                <dd>
                  <code>{anatomy.asset.path.replace("/assets/", "")}</code>
                  <span className={styles.measure}>
                    {anatomy.asset.format}, {formatBytes(anatomy.asset.bytes)} (
                    {formatBytesExact(anatomy.asset.bytes)})
                  </span>
                </dd>
              </div>
              <div>
                <dt>Mesh</dt>
                <dd>
                  <code>{anatomy.mesh.name}</code>
                  <span className={styles.measure}>
                    {formatCount(anatomy.mesh.triangles)} triangles,{" "}
                    {formatCount(anatomy.mesh.vertices)} vertices
                  </span>
                </dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>
                  One L4 vertebra, not the full lumbar series. This is source scan
                  geometry; no clinical validation is claimed.
                </dd>
              </div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="notes-type">
            <h3 id="notes-type">Type and data</h3>
            <p>
              Rethink Sans, Hanken Grotesk and Azeret Mono are served through Google
              Fonts under the SIL Open Font License.
            </p>
            <p className={styles.dataNote}>
              No account and no server receive anything from this page. Completion
              marks stay in this browser.
            </p>
          </section>
        </div>
      </div>
    </dialog>
  );
}
