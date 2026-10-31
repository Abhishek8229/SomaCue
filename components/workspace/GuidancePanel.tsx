"use client";

import { DEMOS, MOVEMENT_STEPS, type DemoId } from "@/lib/assets";
import { useDemoCompletion } from "@/lib/use-demo-completion";
import { AlertIcon, CheckIcon } from "./icons";
import styles from "./GuidancePanel.module.css";

type GuidancePanelProps = {
  activeDemo: DemoId;
};

export function GuidancePanel({ activeDemo }: GuidancePanelProps) {
  const demo = DEMOS[activeDemo];
  const movementDemo = DEMOS.movement;
  const anatomyDemo = DEMOS.anatomy;
  const { complete, toggle } = useDemoCompletion(activeDemo);
  const isMovement = activeDemo === "movement";
  const sourceLead =
    activeDemo === "anatomy"
      ? `${demo.provenance.sourceName} ${demo.provenance.entryId}`
      : `${demo.provenance.sourceName} by ${demo.provenance.creator}`;

  return (
    <aside className={styles.guidance} aria-labelledby={`guidance-${demo.id}`}>
      <div className={styles.scroll}>
        <div className={styles.head}>
          <h1 id={`guidance-${demo.id}`} className={styles.title}>
            {demo.title}
          </h1>
          <div className={styles.meta}>
            <span className={styles.tag}>{demo.metaLabel}</span>
            <p className={styles.source}>
              <a
                href={demo.provenance.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={styles.sourceLink}
              >
                {sourceLead}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              <a
                href={demo.provenance.licence.url}
                target="_blank"
                rel="noreferrer"
                className={styles.licenceLink}
              >
                {demo.provenance.licence.name}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            </p>
          </div>
          <p className={styles.lead}>{demo.summary}</p>
        </div>

        {isMovement ? (
          <>
            <ol className={styles.steps}>
              {MOVEMENT_STEPS.map((step, index) => {
                const caution = index === MOVEMENT_STEPS.length - 1;
                return (
                  <li
                    key={step}
                    className={caution ? styles.cautionStep : styles.step}
                  >
                    {caution ? (
                      <AlertIcon size={16} className={styles.cautionIcon} />
                    ) : null}
                    <p>{step}</p>
                  </li>
                );
              })}
            </ol>
            <p className={styles.clipNote}>
              Clip {movementDemo.clip.name}, {movementDemo.clip.channels} channels.
              The model starts paused.
            </p>
          </>
        ) : (
          <>
            <p className={styles.cameraNote}>
              Front, side and back follow the exported file axes, not anatomical
              planes.
            </p>
            <dl className={styles.facts}>
              {anatomyDemo.stats.map((stat) => (
                <div key={stat.label} className={styles.fact}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>

      <div className={styles.foot}>
        <button
          type="button"
          className={styles.complete}
          onClick={toggle}
          aria-pressed={complete}
          title={complete ? "Clear this completion mark" : undefined}
        >
          {complete ? <CheckIcon size={18} /> : null}
          {complete ? "Demo complete" : "Mark demo complete"}
        </button>
        <p className={styles.localNote}>
          {complete
            ? "Saved on this device. Select again to clear."
            : "Saved on this device only. Nothing is sent."}
        </p>
      </div>
    </aside>
  );
}
