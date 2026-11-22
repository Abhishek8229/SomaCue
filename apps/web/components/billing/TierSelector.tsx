"use client";

import { PERSONALIZED_BADGE, TIER_NOTES } from "@/lib/billing/copy";
import { PRO_TIER_IDS, PRO_TIERS, type ProTier } from "@/lib/billing/plans";

export type TierSelectorProps = {
  value: ProTier;
  onChange: (tier: ProTier) => void;
  /** The tier that covers the user's rehab plan, once they have an analysis */
  recommended: ProTier | null;
  disabled?: boolean;
  /** radio group name, unique on the page */
  name: string;
};

/**
 * 1, 2 or 3 months of Pro. The tier for the user's own plan is preselected and badged; any user
 * can pick a longer one to get the bundle price.
 */
export function TierSelector({ value, onChange, recommended, disabled = false, name }: TierSelectorProps) {
  return (
    <fieldset className="mt-4 min-w-0" disabled={disabled}>
      <legend className="mb-2 text-xs font-medium text-white/70">How long do you want Pro?</legend>
      <div className="grid gap-2 sm:grid-cols-3" data-testid="tier-options">
        {PRO_TIER_IDS.map((id) => {
          const info = PRO_TIERS[id];
          const selected = value === id;
          return (
            <label
              className={`relative flex min-w-0 cursor-pointer flex-col rounded-xl border p-3 transition-colors duration-150 ease-out has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-emerald-300 ${
                selected ? "border-emerald-300 bg-emerald-300/10" : "border-white/15 hover:border-white/35"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              key={id}
            >
              <input
                checked={selected}
                className="sr-only"
                name={name}
                onChange={() => onChange(id)}
                type="radio"
                value={id}
              />
              <span className="text-xs text-white/70">
                {info.name}, {info.span}
              </span>
              <span className="mt-1 text-xl font-semibold tracking-tight text-white">{info.label}</span>
              <span className="mt-0.5 text-[11px] leading-snug text-emerald-200">
                {TIER_NOTES[id]}
                {info.savingsRupees > 0 ? `, save ₹${info.savingsRupees}` : ""}
              </span>
              {recommended === id ? (
                <span className="mt-2 w-fit rounded-full border border-emerald-300/50 bg-emerald-300/15 px-2 py-0.5 text-[10px] font-medium leading-tight text-emerald-100">
                  {PERSONALIZED_BADGE}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
