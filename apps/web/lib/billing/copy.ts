/*
 * The Free vs Pro comparison and the funding note, in one place so the upgrade dialog and the
 * /pricing page always say the same thing. Pain Override is deliberately not a row: it is
 * safety care and free for every plan.
 */

export const COMPARISON_ROWS: ReadonlyArray<{ feature: string; free: string; pro: string }> = [
  { feature: "Discovery triage", free: "1 analysis", pro: "Unlimited re-analysis" },
  {
    feature: "Daily schedule",
    free: "Week 1 only (Days 1–7)",
    pro: "Full adaptive schedule — Day 1 to full plan duration (at least 1 month)",
  },
  {
    feature: "Rehab Companion",
    free: "3 messages",
    pro: "Unlimited chat (practically unlimited; fair-use limits apply if abused)",
  },
  { feature: "3D movement stage", free: "Full controls", pro: "Full controls" },
];

export const FUNDING_NOTE =
  "Upgrading to SomaCue Pro isn't about being greedy — we need a sustainable way to fund AI API costs and cloud deployment costs.";

/** How the tiers are described next to their price. */
export const TIER_NOTES = {
  "1m": "One month",
  "2m": "Discounted bundle",
  "3m": "Best-value discounted bundle",
} as const;

export const PERSONALIZED_BADGE = "Personalized for your analysis";
