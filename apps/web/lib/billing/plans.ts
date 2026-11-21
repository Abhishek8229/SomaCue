/*
 * Plans, limits and the rule that decides which plan a user is on.
 *
 * Pure and free of server imports, so the browser (upgrade modal, calendar locks)
 * and the server (routes and actions) read the same numbers.
 */

export type Plan = "free" | "pro";

/** A billing status as stored in the subscriptions table. */
export type SubscriptionStatus = "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "created",
  "authenticated",
  "active",
  "pending",
  "halted",
  "cancelled",
];

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/**
 * What a blocked request is missing. Sent in the 402 body as `feature`.
 * Pain Override is not here on purpose: stopping, reporting and the safe plan
 * rebuild after a flare-up are free for everyone, because they are safety care.
 */
export type ProFeature = "reanalysis" | "schedule" | "companion";

/** Why the Upgrade dialog was opened. "renew" is a Pro user adding more days. */
export type UpgradeReason = ProFeature | "general" | "renew";

export const PRO_REQUIRED = "PRO_REQUIRED" as const;
/** A Pro user is past the last day of their plan. Not an upgrade problem: a new analysis starts a new plan. */
export const PLAN_WINDOW_ENDED = "PLAN_WINDOW_ENDED" as const;

export type ProRequired = { error: typeof PRO_REQUIRED; feature: ProFeature };

/** Rehab Companion limits. Free is a lifetime total; Pro has rolling fair-use limits. */
export const COMPANION_LIMITS = {
  freeTotal: 3,
  /** Pro: most messages sent continuously, each within `proBurstGapMs` of the last */
  proBurstMessages: 25,
  proBurstGapMs: 10 * 60_000,
  /** Pro: most messages in any rolling window */
  proWindowMessages: 30,
  proWindowMs: 24 * 3_600_000,
} as const;

export const PLAN_LIMITS = {
  free: {
    /** completed Discovery triage analyses */
    analyses: 1,
    /** schedule days available, counted from the day of the analysis (Day 1) */
    scheduleDays: 7,
    /** Rehab Companion messages, in total */
    companionMessages: COMPANION_LIMITS.freeTotal,
  },
  pro: {
    analyses: Infinity,
    /** Pro opens the whole plan (and for as long as the purchased days last), not a fixed day count. */
    scheduleDays: Infinity,
    companionMessages: Infinity,
  },
} as const satisfies Record<Plan, Record<string, number>>;

/** A plan is at least one month, and a month is 30 days. */
export const DAYS_PER_PLAN_MONTH = 30;
export const MIN_PLAN_DAYS = DAYS_PER_PLAN_MONTH;

export function planLengthDays(durationMonths: number | null | undefined): number {
  const months = typeof durationMonths === "number" && Number.isFinite(durationMonths) ? Math.floor(durationMonths) : 1;
  return Math.max(1, months) * DAYS_PER_PLAN_MONTH;
}

/** The Pro durations on sale. One payment buys one fixed window; there are no automatic renewals. */
export type ProTier = "1m" | "2m" | "3m";
export const PRO_TIER_IDS: readonly ProTier[] = ["1m", "2m", "3m"];
export const DEFAULT_TIER: ProTier = "1m";

export type ProTierInfo = {
  id: ProTier;
  months: number;
  days: number;
  /** paise, as sent to Razorpay */
  amountMinor: number;
  currency: "INR";
  /** "₹199" */
  label: string;
  /** "1 month" */
  name: string;
  /** "30 days" */
  span: string;
  /** what 1, 2 or 3 single months would cost, in rupees */
  fullPriceRupees: number;
  savingsRupees: number;
};

/** The price of a single month. The 2 and 3 month bundles are measured against this. */
const PRO_MONTH_RUPEES = 199;

function tier(id: ProTier, months: number, amountRupees: number): ProTierInfo {
  const fullPriceRupees = PRO_MONTH_RUPEES * months;
  return {
    id,
    months,
    days: months * DAYS_PER_PLAN_MONTH,
    amountMinor: amountRupees * 100,
    currency: "INR",
    label: `₹${amountRupees}`,
    name: months === 1 ? "1 month" : `${months} months`,
    span: `${months * DAYS_PER_PLAN_MONTH} days`,
    fullPriceRupees,
    savingsRupees: fullPriceRupees - amountRupees,
  };
}

export const PRO_TIERS: Record<ProTier, ProTierInfo> = {
  "1m": tier("1m", 1, PRO_MONTH_RUPEES),
  "2m": tier("2m", 2, 299),
  "3m": tier("3m", 3, 349),
};

export function isProTier(value: unknown): value is ProTier {
  return typeof value === "string" && (PRO_TIER_IDS as readonly string[]).includes(value);
}

/**
 * The tier that covers the rehab plan the analysis produced: one month for a plan of a month,
 * two for two, three for three or longer. Without a plan yet, one month.
 */
export function recommendedTier(durationMonths: number | null | undefined): ProTier {
  if (typeof durationMonths !== "number" || !Number.isFinite(durationMonths) || durationMonths <= 1) return "1m";
  return durationMonths >= 3 ? "3m" : "2m";
}

export const PRO_DAY_MS = 86_400_000;

/**
 * Where a new purchase's days start: now, or the end of the Pro time the user still has,
 * so renewing early never throws away paid days.
 */
export function accessStartFor(currentEnd: Date | null, now: Date): Date {
  return currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
}

export function accessEndFor(start: Date, days: number): Date {
  return new Date(start.getTime() + days * PRO_DAY_MS);
}
/** The columns of a subscription row that decide access. */
export type SubscriptionAccess = {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

/**
 * Pro while the paid window is open: the subscription is active (or was cancelled to end with
 * the period) and `currentPeriodEnd` is still ahead. Access is decided by that date, not by
 * Razorpay's status, so a Pro window ends exactly when the days run out. A row with no end date
 * (from before windows were stored) follows its status. Everything else is Free.
 */
export function resolvePlan(subscription: SubscriptionAccess | null | undefined, now: Date = new Date()): Plan {
  if (!subscription) return "free";
  const end = subscription.currentPeriodEnd;
  if (end) {
    const open = subscription.status === "active" || subscription.cancelAtPeriodEnd === true;
    return open && end.getTime() > now.getTime() ? "pro" : "free";
  }
  return subscription.status === "active" ? "pro" : "free";
}

/** Remaining Free usage, as shown in the UI. Pro has no counted limits. */
export type FreeUsage = {
  analysesUsed: number;
  analysesLimit: number;
  companionMessagesUsed: number;
  companionMessagesLimit: number;
  scheduleDaysLimit: number;
};

export function usageSummary(plan: Plan, used: { analyses: number; companionMessages: number }) {
  const limits = PLAN_LIMITS[plan];
  return {
    analysesUsed: used.analyses,
    analysesRemaining: Number.isFinite(limits.analyses) ? Math.max(0, limits.analyses - used.analyses) : null,
    companionMessagesUsed: used.companionMessages,
    companionMessagesRemaining: Number.isFinite(limits.companionMessages)
      ? Math.max(0, limits.companionMessages - used.companionMessages)
      : null,
    scheduleDays: Number.isFinite(limits.scheduleDays) ? limits.scheduleDays : null,
  };
}

export type UsageSummary = ReturnType<typeof usageSummary>;

export type CompanionLimitResult =
  /** `remaining` is how many more messages fit before either limit is reached */
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "burst" | "window"; retryAt: Date; retryAfterSeconds: number };

/**
 * Pro fair use, from the times of the user's recent messages (any order; blocked and cleared
 * ones included). Two rolling limits: at most 25 messages sent continuously (each within 10
 * minutes of the one before), and at most 30 in any 24 hours. When both apply, the later reset wins.
 */
export function evaluateProCompanionLimits(sentAt: readonly Date[], now: Date = new Date()): CompanionLimitResult {
  const nowMs = now.getTime();
  const times = sentAt
    .map((date) => date.getTime())
    .filter((time) => time <= nowMs)
    .sort((a, b) => b - a);

  const blocks: Array<{ reason: "burst" | "window"; retryAtMs: number }> = [];

  const inWindow = times.filter((time) => time > nowMs - COMPANION_LIMITS.proWindowMs);
  if (inWindow.length >= COMPANION_LIMITS.proWindowMessages) {
    // Sending is possible again once the message that fills the 30th place is a day old.
    blocks.push({ reason: "window", retryAtMs: inWindow[COMPANION_LIMITS.proWindowMessages - 1] + COMPANION_LIMITS.proWindowMs });
  }

  let streak = 0;
  let previous = nowMs;
  for (const time of times) {
    if (previous - time > COMPANION_LIMITS.proBurstGapMs) break;
    streak += 1;
    previous = time;
  }
  if (streak >= COMPANION_LIMITS.proBurstMessages) {
    // A gap of more than 10 minutes starts a new run.
    blocks.push({ reason: "burst", retryAtMs: times[0] + COMPANION_LIMITS.proBurstGapMs + 1000 });
  }

  if (blocks.length === 0) {
    const windowLeft = COMPANION_LIMITS.proWindowMessages - inWindow.length;
    const burstLeft = COMPANION_LIMITS.proBurstMessages - streak;
    return { allowed: true, remaining: Math.max(0, Math.min(windowLeft, burstLeft)) };
  }
  const worst = blocks.reduce((a, b) => (b.retryAtMs > a.retryAtMs ? b : a));
  return {
    allowed: false,
    reason: worst.reason,
    retryAt: new Date(worst.retryAtMs),
    retryAfterSeconds: Math.max(1, Math.ceil((worst.retryAtMs - nowMs) / 1000)),
  };
}

export const EXPIRY_WARNING_DAYS = 7;

export type ExpiryNotice =
  /** Free, on Day 5 to 7 of the plan: the free Week 1 is about to end */
  | { kind: "free_week_ending"; daysLeft: number }
  /** Pro, with the paid window ending within 7 days */
  | { kind: "pro_expiring"; daysLeft: number; endsAt: string };

/**
 * Which "your access ends soon" banner to show, if any. Computed from what the server told the
 * page (plan, period end, plan day), so it is as accurate as the server's own checks.
 */
export function expiryNotice(
  input: { plan: Plan; currentPeriodEnd: string | null; dayNumber: number | null; hasActivePlan: boolean },
  now: Date = new Date(),
): ExpiryNotice | null {
  if (input.plan === "free") {
    const day = input.dayNumber;
    if (!input.hasActivePlan || day === null || day < 5 || day > PLAN_LIMITS.free.scheduleDays) return null;
    return { kind: "free_week_ending", daysLeft: PLAN_LIMITS.free.scheduleDays - day + 1 };
  }
  if (!input.currentPeriodEnd) return null;
  const end = new Date(input.currentPeriodEnd).getTime();
  if (Number.isNaN(end)) return null;
  const msLeft = end - now.getTime();
  if (msLeft <= 0 || msLeft > EXPIRY_WARNING_DAYS * PRO_DAY_MS) return null;
  return { kind: "pro_expiring", daysLeft: Math.max(1, Math.ceil(msLeft / PRO_DAY_MS)), endsAt: input.currentPeriodEnd };
}

/** Can this plan run another analysis, given how many it has completed? */
export function canRunAnalysis(plan: Plan, analysesCompleted: number): boolean {
  return analysesCompleted < PLAN_LIMITS[plan].analyses;
}

/** Can this plan send another Companion message, given how many it has sent? */
export function canSendCompanionMessage(plan: Plan, messagesSent: number): boolean {
  return messagesSent < PLAN_LIMITS[plan].companionMessages;
}

/** Is plan Day `dayNumber` (Day 1 is the analysis day) inside the plan's schedule? */
/**
 * Is plan Day `dayNumber` (Day 1 is the analysis day) open? Free: Days 1 to 7. Pro: the whole
 * plan, which is `planDays` long.
 */
export function isScheduleDayAllowed(plan: Plan, dayNumber: number, planDays: number = Infinity): boolean {
  return dayNumber <= PLAN_LIMITS[plan].scheduleDays && dayNumber <= planDays;
}

export const PLAN_WINDOW_ENDED_MESSAGE = "Your plan has finished. Run a new analysis to start the next one.";

/** The plan Day number of a date: Day 1 is `startDateKey`. Both are YYYY-MM-DD. */
export function planDayNumber(startDateKey: string, dateKey: string): number {
  const toTime = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toTime(dateKey) - toTime(startDateKey)) / 86_400_000) + 1;
}

export function proRequired(feature: ProFeature): ProRequired {
  return { error: PRO_REQUIRED, feature };
}

export function isProRequired(value: unknown): value is ProRequired {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { error?: unknown }).error === PRO_REQUIRED &&
    typeof (value as { feature?: unknown }).feature === "string"
  );
}

/** What GET /api/billing/status returns, and what the workspace is given on load. */
export type BillingStatus = {
  plan: Plan;
  /** null when the user has never started a subscription */
  status: SubscriptionStatus | null;
  /** ISO time the paid Pro window ends */
  currentPeriodEnd: string | null;
  /** the tier of the latest purchase, or null */
  tier: ProTier | null;
  usage: UsageSummary;
};
