/*
 * A small guard against guessing promo codes: after MAX_FAILURES wrong codes within WINDOW_MS, a user is told to wait.
 * It is kept in memory, so it is per server process. That is enough to make guessing impractical for one account; it is
 * not a substitute for choosing codes that cannot be guessed.
 */

export const PROMO_MAX_FAILURES = 10;
export const PROMO_FAILURE_WINDOW_MS = 15 * 60_000;

const failures = new Map<string, { count: number; resetAt: number }>();

/** Seconds the user must wait, or 0 when they may try. */
export function promoRetryAfterSeconds(userId: string, now: number = Date.now()): number {
  const entry = failures.get(userId);
  if (!entry) return 0;
  if (entry.resetAt <= now) {
    failures.delete(userId);
    return 0;
  }
  return entry.count >= PROMO_MAX_FAILURES ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

export function recordPromoFailure(userId: string, now: number = Date.now()): void {
  const entry = failures.get(userId);
  if (!entry || entry.resetAt <= now) failures.set(userId, { count: 1, resetAt: now + PROMO_FAILURE_WINDOW_MS });
  else entry.count += 1;
  // Keep the map small: forget users whose window has passed.
  if (failures.size > 1000) for (const [id, value] of failures) if (value.resetAt <= now) failures.delete(id);
}

export function clearPromoFailures(userId: string): void {
  failures.delete(userId);
}