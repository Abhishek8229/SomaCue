"use client";

import { useCallback, useState } from "react";
import {
  PatientIntake,
} from "@/components/intake/PatientIntake";
import { StagePanel } from "@/components/workspace/StagePanel";
import { filterSafeExercises } from "@/lib/safety/engine";
import type { ClinicalDiagnosis, Exercise } from "@/lib/safety/engine";
import type { DemoId } from "@/lib/assets";
import styles from "./Workspace.module.css";

const MOCK_EXERCISES: readonly Exercise[] = [
  {
    id: "ex-neutral-breathing",
    name: "Neutral breathing",
    required_movement_planes: ["neutral"],
  },
  {
    id: "ex-deadlift",
    name: "Deadlift",
    required_movement_planes: ["flexion"],
  },
];

export default function WorkspacePage() {
  const [activeDemo, setActiveDemo] = useState<DemoId>("movement");
  const [diagnosis, setDiagnosis] = useState<ClinicalDiagnosis | null>(null);
  const [approvedExercises, setApprovedExercises] = useState<Exercise[]>([]);
  const [locked, setLocked] = useState(false);

  const handleProcessReport = useCallback(async (report: string) => {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportText: report }),
    });

    if (!response.ok) {
      throw new Error("Clinical report extraction failed");
    }

    const extracted = (await response.json()) as ClinicalDiagnosis;
    const screening = filterSafeExercises(extracted, MOCK_EXERCISES);
    setDiagnosis(extracted);
    setApprovedExercises(screening.approved);
    setLocked(false);
  }, []);

  const handleEmergencyFlag = useCallback(() => {
    setDiagnosis(null);
    setApprovedExercises([]);
    setLocked(true);
  }, []);

  return (
    <main className={styles.shell}>
      <div className={styles.intake}>
        <PatientIntake
          onProcessReport={handleProcessReport}
          onEmergencyFlag={handleEmergencyFlag}
        />
      </div>

      <div className={styles.stage}>
        <StagePanel activeDemo={activeDemo} onChangeDemo={setActiveDemo} />

        {approvedExercises.length > 0 ? (
          <aside
            className={styles.roster}
            aria-label="Approved exercises"
            data-testid="approved-roster"
          >
            <h2 className={styles.rosterTitle}>Approved exercises</h2>
            {diagnosis ? (
              <p className={styles.rosterMeta}>
                {diagnosis.region} {diagnosis.level} {diagnosis.pathology}
              </p>
            ) : null}
            <ul className={styles.rosterList}>
              {approvedExercises.map((exercise) => (
                <li key={exercise.id} className={styles.rosterItem}>
                  <span className={styles.rosterName}>{exercise.name}</span>
                  <span className={styles.rosterPlanes}>
                    {exercise.required_movement_planes.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}

        {locked ? (
          <div className={styles.lock} role="alert" data-testid="stage-lock">
            <p className={styles.lockTitle}>Exercise assignment locked</p>
            <p className={styles.lockBody}>
              A red flag was reported during intake. The 3D stage stays locked until the
              screening is restarted.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
