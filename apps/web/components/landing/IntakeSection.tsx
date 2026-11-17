"use client";

import Link from "next/link";
import { useState } from "react";
import { MAX_FILES_PER_CATEGORY } from "@/lib/intake/reportFiles";
import styles from "./sections.module.css";

type Zone = {
  id: "scan" | "prescription";
  title: string;
  hint: string;
  sample: string;
  ext: string;
};

const ZONES: Zone[] = [
  {
    id: "scan",
    title: "Medical scans / imaging",
    hint: "MRI, X-ray, CT scan or other diagnostic imaging",
    sample: "scan",
    ext: "jpg",
  },
  {
    id: "prescription",
    title: "Clinical prescriptions & notes",
    hint: "Prescriptions, assessment notes or reports from a doctor, physio or other clinician",
    sample: "note",
    ext: "pdf",
  },
];

export function IntakeSection() {
  const [files, setFiles] = useState<Record<Zone["id"], string[]>>({ scan: [], prescription: [] });
  const [ack, setAck] = useState(false);
  const [started, setStarted] = useState(false);

  const hasPrescription = files.prescription.length > 0;
  const ready = hasPrescription || ack;

  const add = (zone: Zone) =>
    setFiles((current) => {
      if (current[zone.id].length >= MAX_FILES_PER_CATEGORY) return current;
      const name = `${zone.sample}-${current[zone.id].length + 1}.${zone.ext}`;
      return { ...current, [zone.id]: [...current[zone.id], name] };
    });

  const remove = (zone: Zone, name: string) => {
    setStarted(false);
    setFiles((current) => ({ ...current, [zone.id]: current[zone.id].filter((file) => file !== name) }));
  };

  return (
    <section className={styles.section} id="intake" aria-labelledby="intake-title">
      <div className={styles.wrap}>
        <header className={styles.head}>
          <h2 id="intake-title" className={styles.h2}>
            Scans and clinician notes go in separate slots.
          </h2>
          <p className={styles.lead}>
            Prescriptions reach the AI first, as primary evidence. Try the intake: add a file to either slot.
          </p>
        </header>

        <div className={styles.ticket}>
          {ZONES.map((zone) => (
            <div className={styles.zone} key={zone.id}>
              <h3 className={styles.h3}>{zone.title}</h3>
              <p className={styles.hint}>{zone.hint}</p>
              <ul className={styles.fileList} aria-label={`${zone.title} files`}>
                {files[zone.id].map((name) => (
                  <li className={styles.fileRow} key={name}>
                    <span className={styles.fileName}>{name}</span>
                    <span className={styles.fileState}>Uploaded</span>
                    <button className={styles.iconBtn} onClick={() => remove(zone, name)} type="button" aria-label={`Remove ${name}`}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className={styles.zoneActions}>
                <button
                  className={styles.btnLine}
                  disabled={files[zone.id].length >= MAX_FILES_PER_CATEGORY}
                  onClick={() => add(zone)}
                  type="button"
                >
                  Add sample file
                </button>
                <span className={styles.count}>
                  {files[zone.id].length} of {MAX_FILES_PER_CATEGORY}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.gate} data-state={hasPrescription ? "provided" : "needed"}>
          {hasPrescription ? (
            <div>
              <p className={styles.gateTitle}>Prescription provided</p>
              
            </div>
          ) : (
            <label className={styles.check}>
              <input
                checked={ack}
                className={styles.checkInput}
                onChange={(event) => {
                  setAck(event.target.checked);
                  setStarted(false);
                }}
                type="checkbox"
              />
              <span>I have no prescription</span>
            </label>
          )}
          <div className={styles.gateAction}>
            <button className={styles.btnSolid} disabled={!ready} onClick={() => setStarted(true)} type="button">
              Start diagnostic
            </button>
            <p className={styles.gateNote}>
              {started ? (
                <>
                  <Link href="/register">Register</Link> to run a real intake.
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
