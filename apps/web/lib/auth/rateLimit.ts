/**
 * Small in-memory sliding-window rate limiter for the auth routes.
 * State lives in one server process. That is enough to slow password guessing
 * on a single instance; a multi-instance deployment needs a shared store.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number; remaining: number };

export type RateLimitRule = { key: string; limit: number; windowMs: number };

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > 60 * 60_000) {
      buckets.delete(key);
    }
  }
}

/** Counts one attempt against `rule` and says whether it may proceed. */
export function consumeRateLimit(rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  sweep(now);
  const bucket = buckets.get(rule.key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((time) => now - time < rule.windowMs);

  if (bucket.hits.length >= rule.limit) {
    buckets.set(rule.key, bucket);
    const retryMs = rule.windowMs - (now - bucket.hits[0]);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)), remaining: 0 };
  }

  bucket.hits.push(now);
  buckets.set(rule.key, bucket);
  return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - bucket.hits.length };
}

/** Runs every rule; the first one over its limit blocks the request. */
export function checkRateLimits(rules: RateLimitRule[], now: number = Date.now()): RateLimitResult {
  let blocked: RateLimitResult | null = null;
  let remaining = Infinity;
  for (const rule of rules) {
    const result = consumeRateLimit(rule, now);
    if (!result.allowed && !blocked) blocked = result;
    remaining = Math.min(remaining, result.remaining);
  }
  return blocked ?? { allowed: true, retryAfterSeconds: 0, remaining };
}

export function clearRateLimits() {
  buckets.clear();
}

/** Best-effort client address from the proxy headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

const FIFTEEN_MINUTES = 15 * 60_000;

/** Login: a tight limit per IP + email, and a wider one per IP. */
export function loginRules(ip: string, email: string): RateLimitRule[] {
  return [
    { key: `login:ip-email:${ip}:${email}`, limit: 5, windowMs: FIFTEEN_MINUTES },
    { key: `login:ip:${ip}`, limit: 30, windowMs: FIFTEEN_MINUTES },
  ];
}

/** Register: few accounts per IP and per IP + email. */
export function registerRules(ip: string, email: string): RateLimitRule[] {
  return [
    { key: `register:ip-email:${ip}:${email}`, limit: 3, windowMs: 60 * 60_000 },
    { key: `register:ip:${ip}`, limit: 10, windowMs: 60 * 60_000 },
  ];
}

export function rateLimitMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
