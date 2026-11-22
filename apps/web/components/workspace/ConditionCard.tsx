import {
  CONDITION_SOURCE_LABELS,
  type ConditionSource,
  type DetectedCondition,
  type Escalation,
} from "@/lib/clinical/assessment";

function SourceIcon({ source }: { source: ConditionSource }) {
  const path =
    source === "symptoms_only"
      ? "M4 5h16v11H8l-4 4V5Zm4 4h8m-8 3h5"
      : source === "scans_and_symptoms"
        ? "M4 7V5a1 1 0 0 1 1-1h2m10 0h2a1 1 0 0 1 1 1v2m0 10v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2m3-5h10"
        : "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h4";
  return (
    <svg aria-hidden="true" fill="none" height="12" viewBox="0 0 24 24" width="12">
      <path d={path} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function ConditionCard({
  condition,
  escalation,
}: {
  condition: DetectedCondition;
  escalation: Escalation | null;
}) {
  const needsCare = condition.requiresInPersonCare || escalation !== null;
  const reason =
    escalation?.kind === "progress" ? escalation.reason : (condition.careReason ?? escalation?.reason ?? null);

  return (
    <section
      aria-labelledby="detected-condition-title"
      className={`workspace-panel rounded-2xl border bg-zinc-900 p-4 ${needsCare ? "condition-card-alert" : "border-white/15"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[9px] font-medium text-emerald-300">Triage summary</p>
          <h2 className="text-base font-medium tracking-tight">Detected condition</h2>
        </div>
        <span className="shrink-0 rounded-md bg-white/10 px-2 py-1 font-mono text-[9px] text-white/60">
          AI assessment
        </span>
      </div>

      <h3 className="mt-3 text-sm font-semibold leading-snug text-white" id="detected-condition-title">
        {condition.title}
      </h3>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/70">{condition.summary}</p>

      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/75">
        <SourceIcon source={condition.source} />
        {CONDITION_SOURCE_LABELS[condition.source]}
      </p>

      {needsCare ? (
        <div className="mt-3 rounded-xl border border-red-400/50 bg-red-500/15 px-3 py-2.5" role="alert">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red-100">
            <svg aria-hidden="true" fill="none" height="13" viewBox="0 0 24 24" width="13">
              <path d="M12 8v5m0 3.5h.01M10.3 3.8 2.8 17a2 2 0 0 0 1.74 3h14.92a2 2 0 0 0 1.74-3L13.7 3.8a2 2 0 0 0-3.4 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
            Requires immediate in-person medical evaluation
          </p>
          {reason ? <p className="mt-1 text-[10px] leading-relaxed text-red-100/85">{reason}</p> : null}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-emerald-100">Suitable for guided online rehab</p>
          {condition.careReason ? (
            <p className="mt-1 text-[10px] leading-relaxed text-white/60">{condition.careReason}</p>
          ) : null}
        </div>
      )}

      <p className="mt-3 text-[9px] leading-relaxed text-white/40">
        AI-generated assessment, not a medical diagnosis. Confirm it with a clinician.
      </p>
    </section>
  );
}
