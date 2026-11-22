/*
 * Promo codes come from the PROMO_CODES environment variable, never from the code or the database:
 *
 *   PROMO_CODES="SOMACUE2M,INTERVIEW2026:25"
 *
 * Comma-separated, case-insensitive, whitespace ignored. A `:N` suffix caps how many users can redeem that code in
 * total; without it any number of different users can. Each redeemed code grants PROMO_DURATION_DAYS of Pro.
 * The variable is read on every request, so adding or removing a code needs no rebuild.
 */

/** Two months of Pro, counted the way plans are: 30-day months. */
export const PROMO_DURATION_DAYS = 60;

/** Shown as the "2 months" tier in the billing panel. */
export const PROMO_TIER = "2m" as const;

export type PromoCode = { code: string; maxUses: number | null };

/** Letters, digits, dashes and underscores, 3 to 40 characters. Anything else in the variable is ignored. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,39}$/;

/** What a user typed, as it is compared: trimmed and upper-case. */
export function normalizePromoInput(input: unknown): string {
  return typeof input === "string" ? input.trim().toUpperCase() : "";
}

/**
 * Every usable code in the variable. An entry that is malformed, or whose `:N` is not a whole number of at least 1, is
 * dropped rather than guessed at (so a typo never turns a capped code into an unlimited one). A code listed twice keeps
 * its first entry.
 */
export function parsePromoCodes(raw: string | undefined | null): PromoCode[] {
  const codes = new Map<string, PromoCode>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const code = normalizePromoInput(colon === -1 ? trimmed : trimmed.slice(0, colon));
    if (!CODE_PATTERN.test(code)) continue;

    let maxUses: number | null = null;
    if (colon !== -1) {
      const suffix = trimmed.slice(colon + 1).trim();
      if (!/^\d+$/.test(suffix) || Number(suffix) < 1) continue;
      maxUses = Number(suffix);
    }
    if (!codes.has(code)) codes.set(code, { code, maxUses });
  }
  return [...codes.values()];
}

/** The configured code that matches what the user typed, or null. */
export function findPromoCode(input: unknown, raw: string | undefined | null = process.env.PROMO_CODES): PromoCode | null {
  const wanted = normalizePromoInput(input);
  return wanted ? (parsePromoCodes(raw).find((entry) => entry.code === wanted) ?? null) : null;
}