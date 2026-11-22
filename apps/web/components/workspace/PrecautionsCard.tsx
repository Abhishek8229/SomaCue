"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { markPrecautionsSeen } from "@/actions/precautions";
import { isUnread, type DynamicPrecautions } from "@/lib/precautions/precautions";

type Tab = "permanent" | "dynamic";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "permanent", label: "Permanent" },
  { id: "dynamic", label: "Dynamic" },
];

const interactive =
  "transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 focus-visible:outline-offset-2";

/** A change in the plan (feedback, Pain Override, a missed day) rather than the normal start of a week. */
const isChangeBadge = (kind: DynamicPrecautions["kind"]) => kind === "feedback" || kind === "pain_override" || kind === "missed_day";

export type PrecautionsCardProps = {
  /** the active report, so opening the Dynamic tab can be remembered */
  reportId: string | null;
  permanent: readonly string[];
  dynamic: DynamicPrecautions;
  /** the browser's local date (YYYY-MM-DD), used if a plan saved before precautions needs them stored */
  todayKey?: string;
};

/**
 * Safety bullets for the plan, beside the triage summary. Permanent: about the condition, from the
 * analysis. Dynamic: for the current week and the latest feedback, with a dot when it changed since the
 * user last looked.
 */
export function PrecautionsCard({ reportId, permanent, dynamic, todayKey }: PrecautionsCardProps) {
  const [tab, setTab] = useState<Tab>("permanent");
  // What this visit has already told the server: valid only for the update it was recorded against.
  const [seen, setSeen] = useState<{ updatedAt: string; seenAt: string } | null>(null);
  const base = useId();

  const effective = seen && seen.updatedAt === dynamic.updatedAt ? { ...dynamic, seenAt: seen.seenAt } : dynamic;
  const unread = isUnread(effective);

  // Reading the Dynamic tab counts as seeing it. This also covers an update that arrives while it is open.
  useEffect(() => {
    if (tab !== "dynamic" || !unread || !reportId) return;
    let cancelled = false;
    void markPrecautionsSeen(reportId, todayKey).then((result) => {
      if (!cancelled && result.success && result.seenAt) setSeen({ updatedAt: dynamic.updatedAt, seenAt: result.seenAt });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, unread, reportId, todayKey, dynamic.updatedAt]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    setTab((current) => (current === "permanent" ? "dynamic" : "permanent"));
    document.getElementById(`${base}-tab-${tab === "permanent" ? "dynamic" : "permanent"}`)?.focus();
  };

  const items = tab === "permanent" ? permanent : dynamic.items;

  return (
    <section aria-labelledby={`${base}-title`} className="workspace-panel rounded-2xl border border-white/15 bg-zinc-900 p-4" data-testid="precautions-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[9px] font-medium text-emerald-300">Stay safe</p>
          <h2 className="text-base font-medium tracking-tight" id={`${base}-title`}>
            Precautions
          </h2>
        </div>
        {tab === "dynamic" ? (
          <span
            className={`mt-0.5 shrink-0 rounded-md px-2 py-1 text-[9px] ${
              isChangeBadge(dynamic.kind) ? "bg-amber-300/15 text-amber-200" : "bg-emerald-300/15 text-emerald-300"
            }`}
            data-testid="precautions-badge"
          >
            {dynamic.badge}
          </span>
        ) : null}
      </div>

      <div aria-label="Precaution type" className="mt-3 inline-flex rounded-lg border border-white/15 p-0.5" role="tablist">
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              aria-controls={`${base}-panel`}
              aria-selected={selected}
              className={`${interactive} relative rounded-md px-3 py-1 text-[10px] font-medium ${
                selected ? "bg-emerald-300 text-zinc-950!" : "text-white/65 hover:text-white"
              }`}
              id={`${base}-tab-${item.id}`}
              key={item.id}
              onClick={() => setTab(item.id)}
              onKeyDown={onKeyDown}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {item.label}
              {item.id === "dynamic" && unread ? (
                <>
                  <span aria-hidden="true" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-300 align-middle" data-testid="precautions-dot" />
                  <span className="sr-only"> (updated)</span>
                </>
              ) : null}
            </button>
          );
        })}
      </div>

      <div aria-labelledby={`${base}-tab-${tab}`} id={`${base}-panel`} role="tabpanel">
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li className="flex gap-2 text-[11px] leading-relaxed text-white/80" key={item}>
              <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[9px] leading-relaxed text-white/40">General safety guidance, not medical advice. Stop and get help if something feels wrong.</p>
    </section>
  );
}
