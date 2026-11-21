// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  subscription: null as null | {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
    tier?: string | null;
  },
  analyses: 0,
  messages: 0,
  /** createdAt of the user's recent chat messages */
  recent: [] as Date[],
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    subscription: { findUnique: async () => db.subscription },
    clinicalReport: { count: async () => db.analyses },
    chatMessage: {
      count: async () => db.messages,
      findMany: async ({ take }: { take: number }) =>
        db.recent
          .slice()
          .sort((a, b) => b.getTime() - a.getTime())
          .slice(0, take)
          .map((createdAt) => ({ createdAt })),
    },
  },
}));

import * as entitlements from "@/lib/billing/entitlements";
import {
  checkAnalysisAllowed,
  checkCompanionAllowed,
  checkProCompanionLimits,
  checkScheduleDayAllowed,
  getBillingStatus,
  proRequiredResponse,
} from "@/lib/billing/entitlements";
import {
  accessEndFor,
  accessStartFor,
  canRunAnalysis,
  canSendCompanionMessage,
  evaluateProCompanionLimits,
  expiryNotice,
  isScheduleDayAllowed,
  PLAN_LIMITS,
  planDayNumber,
  planLengthDays,
  PRO_TIERS,
  recommendedTier,
  resolvePlan,
  usageSummary,
} from "@/lib/billing/plans";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sub = (status: string, cancelAtPeriodEnd = false, currentPeriodEnd: Date | null = null) => ({ status, cancelAtPeriodEnd, currentPeriodEnd });
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("resolvePlan", () => {
  it("is Free with no subscription", () => {
    expect(resolvePlan(null, NOW)).toBe("free");
    expect(resolvePlan(undefined, NOW)).toBe("free");
  });

  it("is Pro while the paid window is open, and Free the moment it ends", () => {
    expect(resolvePlan(sub("active", false, new Date(NOW.getTime() + HOUR)), NOW)).toBe("pro");
    expect(resolvePlan(sub("active", false, new Date(NOW.getTime() - HOUR)), NOW)).toBe("free");
    expect(resolvePlan(sub("active", false, NOW), NOW)).toBe("free");
  });

  it("follows the status for an older row that has no end date", () => {
    expect(resolvePlan(sub("active"), NOW)).toBe("pro");
    for (const status of ["created", "authenticated", "pending", "halted", "cancelled"]) {
      expect(resolvePlan(sub(status), NOW), status).toBe("free");
    }
  });

  it("does not give Pro to a failed payment that merely has a future end date", () => {
    const later = new Date(NOW.getTime() + HOUR);
    expect(resolvePlan(sub("halted", false, later), NOW)).toBe("free");
    expect(resolvePlan(sub("pending", false, later), NOW)).toBe("free");
  });

  it("keeps an older cancelled row Pro until its period ends", () => {
    expect(resolvePlan(sub("cancelled", true, new Date(NOW.getTime() + HOUR)), NOW)).toBe("pro");
    expect(resolvePlan(sub("cancelled", true, new Date(NOW.getTime() - HOUR)), NOW)).toBe("free");
    expect(resolvePlan(sub("cancelled", true, null), NOW)).toBe("free");
  });
});

describe("plan limits", () => {
  it("Free: 1 analysis, Week 1 only (Days 1 to 7), 3 Companion messages", () => {
    expect(canRunAnalysis("free", 0)).toBe(true);
    expect(canRunAnalysis("free", 1)).toBe(false);
    expect(canSendCompanionMessage("free", 2)).toBe(true);
    expect(canSendCompanionMessage("free", 3)).toBe(false);
    expect(isScheduleDayAllowed("free", 7)).toBe(true);
    expect(isScheduleDayAllowed("free", 8)).toBe(false);
    // Free cannot reach past Day 7 even in a very long plan.
    expect(isScheduleDayAllowed("free", 8, 90)).toBe(false);
  });

  it("Pro: unlimited analyses and messages, and the whole plan, whatever its length", () => {
    expect(canRunAnalysis("pro", 500)).toBe(true);
    expect(canSendCompanionMessage("pro", 5000)).toBe(true);
    expect(isScheduleDayAllowed("pro", 8, 30)).toBe(true);
    expect(isScheduleDayAllowed("pro", 30, 30)).toBe(true);
    expect(isScheduleDayAllowed("pro", 31, 30)).toBe(false);
    expect(isScheduleDayAllowed("pro", 90, 90)).toBe(true);
    expect(isScheduleDayAllowed("pro", 91, 90)).toBe(false);
  });

  it("has no Pain Override paywall anywhere in the limits or the checks", () => {
    expect(Object.keys(PLAN_LIMITS.free)).not.toContain("adaptivePainOverride");
    expect(Object.keys(PLAN_LIMITS.pro)).not.toContain("adaptivePainOverride");
    expect("checkAdaptivePainOverrideAllowed" in entitlements).toBe(false);
  });

  it("makes every plan at least one 30-day month", () => {
    expect(planLengthDays(1)).toBe(30);
    expect(planLengthDays(2)).toBe(60);
    expect(planLengthDays(3)).toBe(90);
    expect(planLengthDays(0)).toBe(30);
    expect(planLengthDays(undefined)).toBe(30);
    expect(planLengthDays(Number.NaN)).toBe(30);
  });

  it("counts plan days with Day 1 as the analysis day", () => {
    expect(planDayNumber("2026-11-19", "2026-11-19")).toBe(1);
    expect(planDayNumber("2026-11-19", "2026-11-25")).toBe(7);
    expect(planDayNumber("2026-11-19", "2026-11-26")).toBe(8);
    expect(planDayNumber("2026-11-30", "2026-12-02")).toBe(3);
  });

  it("reports remaining Free usage, and no counted limits for Pro", () => {
    expect(usageSummary("free", { analyses: 1, companionMessages: 2 })).toMatchObject({
      analysesRemaining: 0,
      companionMessagesRemaining: 1,
      scheduleDays: 7,
    });
    expect(usageSummary("pro", { analyses: 4, companionMessages: 80 })).toMatchObject({
      analysesRemaining: null,
      companionMessagesRemaining: null,
      scheduleDays: null,
    });
  });
});

describe("Pro tiers", () => {
  it("sells 30 days for ₹199, 60 days for ₹299 and 90 days for ₹349", () => {
    expect(PRO_TIERS["1m"]).toMatchObject({ days: 30, amountMinor: 19900, label: "₹199", savingsRupees: 0 });
    expect(PRO_TIERS["2m"]).toMatchObject({ days: 60, amountMinor: 29900, label: "₹299", savingsRupees: 99 });
    expect(PRO_TIERS["3m"]).toMatchObject({ days: 90, amountMinor: 34900, label: "₹349", savingsRupees: 248 });
  });

  it("recommends the tier that covers the analysis plan", () => {
    expect(recommendedTier(null)).toBe("1m");
    expect(recommendedTier(1)).toBe("1m");
    expect(recommendedTier(2)).toBe("2m");
    expect(recommendedTier(3)).toBe("3m");
    expect(recommendedTier(9)).toBe("3m");
  });

  it("starts new days after the Pro time the user still has, so renewing early loses nothing", () => {
    const stillPro = new Date(NOW.getTime() + 5 * DAY);
    expect(accessStartFor(stillPro, NOW)).toEqual(stillPro);
    expect(accessStartFor(new Date(NOW.getTime() - DAY), NOW)).toEqual(NOW);
    expect(accessStartFor(null, NOW)).toEqual(NOW);
    expect(accessEndFor(NOW, 60).getTime() - NOW.getTime()).toBe(60 * DAY);
  });
});

describe("expiry notices", () => {
  const free = (dayNumber: number | null, hasActivePlan = true) => ({ plan: "free" as const, currentPeriodEnd: null, dayNumber, hasActivePlan });

  it("warns a Free user on Days 5, 6 and 7, and not before or after", () => {
    expect(expiryNotice(free(4), NOW)).toBeNull();
    expect(expiryNotice(free(5), NOW)).toEqual({ kind: "free_week_ending", daysLeft: 3 });
    expect(expiryNotice(free(6), NOW)).toEqual({ kind: "free_week_ending", daysLeft: 2 });
    expect(expiryNotice(free(7), NOW)).toEqual({ kind: "free_week_ending", daysLeft: 1 });
    expect(expiryNotice(free(8), NOW)).toBeNull();
    expect(expiryNotice(free(null), NOW)).toBeNull();
    expect(expiryNotice(free(6, false), NOW)).toBeNull();
  });

  it("warns a Pro user within 7 days of the end of their paid window", () => {
    const pro = (end: Date) => ({ plan: "pro" as const, currentPeriodEnd: end.toISOString(), dayNumber: 3, hasActivePlan: true });
    expect(expiryNotice(pro(new Date(NOW.getTime() + 8 * DAY)), NOW)).toBeNull();
    expect(expiryNotice(pro(new Date(NOW.getTime() + 7 * DAY)), NOW)).toMatchObject({ kind: "pro_expiring", daysLeft: 7 });
    expect(expiryNotice(pro(new Date(NOW.getTime() + 2 * DAY - HOUR)), NOW)).toMatchObject({ kind: "pro_expiring", daysLeft: 2 });
    expect(expiryNotice(pro(new Date(NOW.getTime() + HOUR)), NOW)).toMatchObject({ kind: "pro_expiring", daysLeft: 1 });
    expect(expiryNotice(pro(new Date(NOW.getTime() - HOUR)), NOW)).toBeNull();
    expect(expiryNotice({ plan: "pro", currentPeriodEnd: null, dayNumber: 3, hasActivePlan: true }, NOW)).toBeNull();
  });
});

describe("Rehab Companion Pro fair use", () => {
  /** n messages spaced `gapMs` apart, the newest `lastAgoMs` ago */
  const run = (n: number, gapMs: number, lastAgoMs = MIN) => Array.from({ length: n }, (_, i) => ago(lastAgoMs + i * gapMs));

  it("allows a normal chat and says how many messages fit", () => {
    expect(evaluateProCompanionLimits([], NOW)).toEqual({ allowed: true, remaining: 25 });
    expect(evaluateProCompanionLimits(run(10, MIN), NOW)).toEqual({ allowed: true, remaining: 15 });
  });

  it("allows the 25th message in a continuous run and blocks the 26th", () => {
    expect(evaluateProCompanionLimits(run(24, MIN), NOW)).toMatchObject({ allowed: true, remaining: 1 });
    const blocked = evaluateProCompanionLimits(run(25, MIN), NOW);
    expect(blocked).toMatchObject({ allowed: false, reason: "burst" });
    // The run restarts once there has been more than 10 minutes of quiet.
    if (!blocked.allowed) expect(blocked.retryAt.getTime()).toBe(ago(MIN).getTime() + 10 * MIN + 1000);
  });

  it("counts messages as continuous only while each is within 10 minutes of the next", () => {
    // 25 messages, but a 11-minute silence splits them: the current run is short.
    const split = [...run(10, MIN), ...run(15, MIN, MIN + 10 * MIN + 11 * MIN)];
    expect(evaluateProCompanionLimits(split, NOW)).toMatchObject({ allowed: true });
    // Exactly 10 minutes apart still counts as continuous.
    expect(evaluateProCompanionLimits(run(25, 10 * MIN, 5 * MIN), NOW)).toMatchObject({ allowed: false, reason: "burst" });
    // The newest message is already older than 10 minutes: a new run starts at zero.
    expect(evaluateProCompanionLimits(run(25, MIN, 11 * MIN), NOW)).toMatchObject({ allowed: true, remaining: 5 });
  });

  it("allows 30 messages in 24 hours when spaced out, and blocks the 31st with the reset time", () => {
    const spaced = (n: number) => Array.from({ length: n }, (_, i) => ago(HOUR / 2 + i * 40 * MIN)); // every 40 minutes
    expect(evaluateProCompanionLimits(spaced(29), NOW)).toMatchObject({ allowed: true });
    const blocked = evaluateProCompanionLimits(spaced(30), NOW);
    expect(blocked).toMatchObject({ allowed: false, reason: "window" });
    if (!blocked.allowed) {
      // Frees up when the 30th-newest message is 24 hours old.
      expect(blocked.retryAt.getTime()).toBe(spaced(30)[29].getTime() + DAY);
      expect(blocked.retryAfterSeconds).toBe(Math.ceil((blocked.retryAt.getTime() - NOW.getTime()) / 1000));
    }
  });

  it("does not count messages older than 24 hours", () => {
    const old = Array.from({ length: 40 }, (_, i) => ago(DAY + HOUR + i * 5 * MIN));
    expect(evaluateProCompanionLimits(old, NOW)).toMatchObject({ allowed: true, remaining: 25 });
  });

  it("reports the later reset when both limits apply", () => {
    // 30 messages one minute apart: both the burst and the 24-hour limit are hit.
    const both = evaluateProCompanionLimits(run(30, MIN), NOW);
    expect(both).toMatchObject({ allowed: false, reason: "window" });
  });

  it("reads the stored message times from the database", async () => {
    db.recent = run(25, MIN);
    expect(await checkProCompanionLimits("u1", NOW)).toMatchObject({ allowed: false, reason: "burst" });
    db.recent = [];
    expect(await checkProCompanionLimits("u1", NOW)).toMatchObject({ allowed: true });
  });
});

describe("server checks", () => {
  beforeEach(() => {
    db.subscription = null;
    db.analyses = 0;
    db.messages = 0;
    db.recent = [];
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return () => vi.useRealTimers();
  });

  const open = (days = 10) => sub("active", false, new Date(NOW.getTime() + days * DAY));

  it("allows the first analysis and blocks the second on Free, with the feature named", async () => {
    expect(await checkAnalysisAllowed("u1")).toBeNull();
    db.analyses = 1;
    expect(await checkAnalysisAllowed("u1")).toEqual({ error: "PRO_REQUIRED", feature: "reanalysis" });
  });

  it("lets Pro re-run analyses without limit", async () => {
    db.subscription = open();
    db.analyses = 25;
    expect(await checkAnalysisAllowed("u1")).toBeNull();
  });

  it("blocks the fourth Companion message on Free, but not the third", async () => {
    db.messages = 2;
    expect(await checkCompanionAllowed("u1")).toBeNull();
    db.messages = 3;
    expect(await checkCompanionAllowed("u1")).toEqual({ error: "PRO_REQUIRED", feature: "companion" });
  });

  it("blocks plan Day 8 on Free (Week 1 only) and allows it on Pro", async () => {
    expect(await checkScheduleDayAllowed("u1", "2026-11-12", "2026-11-18", 90)).toBeNull(); // Day 7
    expect(await checkScheduleDayAllowed("u1", "2026-11-12", "2026-11-19", 90)).toEqual({ error: "PRO_REQUIRED", feature: "schedule" }); // Day 8
    db.subscription = open();
    expect(await checkScheduleDayAllowed("u1", "2026-11-12", "2026-11-19", 90)).toBeNull();
  });

  it("opens the whole plan to Pro, up to its length (30, 60 or 90 days)", async () => {
    db.subscription = open(120);
    // A 30-day plan started on 2026-10-21: Day 30 is open, Day 31 means the plan has finished.
    expect(await checkScheduleDayAllowed("u1", "2026-10-21", "2026-11-19", 30)).toBeNull(); // Day 30
    expect(await checkScheduleDayAllowed("u1", "2026-10-21", "2026-11-20", 30)).toEqual({ error: "PLAN_WINDOW_ENDED" }); // Day 31
    // A 90-day plan keeps going.
    expect(await checkScheduleDayAllowed("u1", "2026-08-22", "2026-11-19", 90)).toBeNull(); // Day 90
    expect(await checkScheduleDayAllowed("u1", "2026-08-22", "2026-11-20", 90)).toEqual({ error: "PLAN_WINDOW_ENDED" }); // Day 91
  });

  it("sends a Pro user whose purchased days ran out back to Free: Day 8 on asks for Pro again", async () => {
    db.subscription = sub("active", false, new Date(NOW.getTime() - HOUR));
    expect(await checkScheduleDayAllowed("u1", "2026-11-01", "2026-11-19", 90)).toEqual({ error: "PRO_REQUIRED", feature: "schedule" });
  });

  it("builds the billing status the UI shows, with the end date and tier only while Pro is open", async () => {
    const end = new Date(NOW.getTime() + 20 * DAY);
    db.subscription = { ...sub("active", false, end), tier: "2m" };
    db.analyses = 3;
    db.messages = 10;
    expect(await getBillingStatus("u1")).toEqual({
      plan: "pro",
      status: "active",
      currentPeriodEnd: end.toISOString(),
      tier: "2m",
      usage: { analysesUsed: 3, analysesRemaining: null, companionMessagesUsed: 10, companionMessagesRemaining: null, scheduleDays: null },
    });
    db.subscription = { ...sub("active", false, new Date(NOW.getTime() - HOUR)), tier: "2m" };
    expect(await getBillingStatus("u1")).toMatchObject({ plan: "free", currentPeriodEnd: null, tier: null });
    db.subscription = null;
    db.analyses = 1;
    db.messages = 3;
    expect(await getBillingStatus("u1")).toMatchObject({
      plan: "free",
      status: null,
      usage: { analysesRemaining: 0, companionMessagesRemaining: 0, scheduleDays: 7 },
    });
  });

  it("answers a block with HTTP 402 and the feature in the body", async () => {
    const response = proRequiredResponse({ error: "PRO_REQUIRED", feature: "schedule" });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "PRO_REQUIRED", feature: "schedule" });
  });
});
