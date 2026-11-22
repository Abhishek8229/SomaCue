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
  /** when the user's latest treatment plan was made, or null */
  planCreatedAt: null as Date | null,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    subscription: { findUnique: async () => db.subscription },
    clinicalReport: { count: async () => db.analyses },
    treatmentPlan: { findFirst: async () => (db.planCreatedAt ? { createdAt: db.planCreatedAt } : null) },
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
  getCompanionAllowance,
  checkScheduleDayAllowed,
  getBillingStatus,
  proRequiredResponse,
} from "@/lib/billing/entitlements";
import {
  accessEndFor,
  accessStartFor,
  canRunAnalysis,
  canSendCompanionMessage,
  COMPANION_LIMITS,
  evaluateCompanionAllowance,
  freeWindowEnd,
  messagesLeft,
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
  it("Free: 1 analysis, Week 1 only (Days 1 to 7), 10 Companion messages in total", () => {
    expect(canRunAnalysis("free", 0)).toBe(true);
    expect(canRunAnalysis("free", 1)).toBe(false);
    expect(canSendCompanionMessage("free", 9)).toBe(true);
    expect(canSendCompanionMessage("free", 10)).toBe(false);
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
    expect(usageSummary("free", { analyses: 1, companionMessages: 9 })).toMatchObject({
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

describe("Rehab Companion limits", () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const free = (extra: Partial<Parameters<typeof evaluateCompanionAllowance>[0]> = {}) => ({
    plan: "free" as const,
    sentAt: [] as Date[],
    sentTotal: 0,
    freeWindowEndsAt: null,
    ...extra,
  });
  const pro = (sentAt: Date[] = []) => ({ plan: "pro" as const, sentAt, sentTotal: 0, freeWindowEndsAt: null });

  it("has the numbers: Free 3 a day and 10 in the 7 days, Pro 50 in any 7 days", () => {
    expect(COMPANION_LIMITS).toMatchObject({ perDay: 3, freeTotal: 10, freeWindowDays: 7, proPerWeek: 50 });
    expect(COMPANION_LIMITS.weekMs).toBe(168 * HOUR);
    expect(PLAN_LIMITS.free.companionMessages).toBe(10);
  });

  describe("Pro: a fair-use limit of 50 messages in any rolling 7 days (168 hours)", () => {
    /** n messages, one every `gapMs`, the newest `lastAgoMs` ago */
    const run = (n: number, gapMs: number, lastAgoMs = HOUR) => Array.from({ length: n }, (_, i) => ago(lastAgoMs + i * gapMs));

    it("has no daily limit: far more than 3 in a day is fine", () => {
      const result = evaluateCompanionAllowance(pro(run(20, MIN)), NOW);
      expect(result.verdict.allowed).toBe(true);
      expect(result.usage).toMatchObject({ dailyLimit: null, dailyLeft: null, weeklyLimit: 50, weeklyLeft: 30, totalLimit: null, totalLeft: null, windowEndsAt: null });
    });

    it("allows the 50th message in a week and blocks the 51st", () => {
      expect(evaluateCompanionAllowance(pro(run(49, HOUR / 4)), NOW)).toMatchObject({ verdict: { allowed: true }, usage: { weeklyLeft: 1 } });
      const blocked = evaluateCompanionAllowance(pro(run(50, HOUR / 4)), NOW);
      expect(blocked.verdict).toMatchObject({ allowed: false, reason: "weekly" });
      expect(blocked.usage).toMatchObject({ weeklyLeft: 0 });
    });

    it("opens the next slot 168 hours after the oldest of the 50, and says how long that is", () => {
      // the oldest of the 50 counted messages was sent 3 days ago
      const sent = [...run(49, HOUR / 4), ago(3 * DAY)];
      const result = evaluateCompanionAllowance(pro(sent), NOW);
      expect(result.usage.nextSlotAt).toBe(new Date(NOW.getTime() + 4 * DAY).toISOString());
      expect(result.verdict).toMatchObject({ allowed: false, reason: "weekly", retryAfterSeconds: 4 * 24 * 3600 });
      if (!result.verdict.allowed && result.verdict.reason === "weekly") {
        expect(result.verdict.retryAt.getTime()).toBe(NOW.getTime() + 4 * DAY);
      }
    });

    it("is a rolling 168 hours: a message sent a week ago no longer counts", () => {
      const fresh = run(49, HOUR / 4);
      expect(evaluateCompanionAllowance(pro([...fresh, ago(7 * DAY)]), NOW).verdict.allowed).toBe(true);
      expect(evaluateCompanionAllowance(pro([...fresh, ago(7 * DAY - MIN)]), NOW).verdict.allowed).toBe(false);
    });

    it("has no total cap and no 7-day end, however many were sent before", () => {
      expect(evaluateCompanionAllowance({ ...pro(), sentTotal: 5000, freeWindowEndsAt: ago(30 * DAY) }, NOW).verdict.allowed).toBe(true);
    });

    it("counts only the messages in the last week when working out what is left", () => {
      const old = Array.from({ length: 80 }, (_, i) => ago(8 * DAY + i * HOUR));
      expect(evaluateCompanionAllowance(pro(old), NOW).usage.weeklyLeft).toBe(50);
    });
  });
  describe("Free: 3 a day, and 10 in total during the 7 days after the plan was made", () => {
    it("shows both counters", () => {
      const result = evaluateCompanionAllowance(free({ sentAt: [ago(HOUR)], sentTotal: 4, freeWindowEndsAt: new Date(NOW.getTime() + 3 * DAY) }), NOW);
      expect(result.verdict.allowed).toBe(true);
      expect(result.usage).toMatchObject({ dailyLimit: 3, dailyLeft: 2, totalLimit: 10, totalLeft: 6, windowEndsAt: new Date(NOW.getTime() + 3 * DAY).toISOString() });
      expect(messagesLeft(result.usage)).toBe(2);
      expect(messagesLeft({ ...result.usage, dailyLeft: 3, totalLeft: 1 })).toBe(1);
    });

    it("blocks the fourth message in a day with the daily reason, even with total left", () => {
      const result = evaluateCompanionAllowance(free({ sentAt: [ago(MIN), ago(2 * MIN), ago(3 * MIN)], sentTotal: 3 }), NOW);
      expect(result.verdict).toMatchObject({ allowed: false, reason: "daily" });
      expect(result.usage.totalLeft).toBe(7);
    });

    it("allows the 10th message in total and blocks the 11th, however long ago the others were", () => {
      expect(evaluateCompanionAllowance(free({ sentTotal: 9 }), NOW).verdict.allowed).toBe(true);
      expect(evaluateCompanionAllowance(free({ sentTotal: 10 }), NOW).verdict).toEqual({ allowed: false, reason: "total" });
      expect(evaluateCompanionAllowance(free({ sentTotal: 11 }), NOW).usage.totalLeft).toBe(0);
    });

    it("blocks after the 7-day window ends, even with messages left", () => {
      const ended = evaluateCompanionAllowance(free({ sentTotal: 2, freeWindowEndsAt: ago(MIN) }), NOW);
      expect(ended.verdict).toEqual({ allowed: false, reason: "window_ended" });
      expect(ended.usage.totalLeft).toBe(8);
      expect(evaluateCompanionAllowance(free({ sentTotal: 2, freeWindowEndsAt: new Date(NOW.getTime() + MIN) }), NOW).verdict.allowed).toBe(true);
      // the window ends exactly at its end time
      expect(evaluateCompanionAllowance(free({ freeWindowEndsAt: NOW }), NOW).verdict).toEqual({ allowed: false, reason: "window_ended" });
    });

    it("has no window before a plan exists: chatting before the first analysis is allowed", () => {
      expect(evaluateCompanionAllowance(free({ sentTotal: 1, freeWindowEndsAt: null }), NOW)).toMatchObject({ verdict: { allowed: true }, usage: { windowEndsAt: null } });
    });

    it("reports the window as 7 days after the plan was made", () => {
      expect(freeWindowEnd(NOW).getTime() - NOW.getTime()).toBe(7 * DAY);
    });
  });

  describe("read from the database", () => {
    beforeEach(() => {
      db.subscription = null;
      db.messages = 0;
      db.recent = [];
      db.planCreatedAt = null;
    });

    it("counts a Free user's total, today's messages and the window from the latest plan", async () => {
      db.messages = 4;
      db.recent = [ago(HOUR)];
      db.planCreatedAt = ago(2 * DAY);
      const check = await getCompanionAllowance("u1", "free", NOW);
      expect(check.verdict.allowed).toBe(true);
      expect(check.usage).toMatchObject({ dailyLeft: 2, totalLeft: 6, windowEndsAt: new Date(NOW.getTime() + 5 * DAY).toISOString() });
      // and as it will stand once this message is saved
      expect(check.after).toMatchObject({ dailyLeft: 1, totalLeft: 5 });
    });

    it("blocks a Free user on Day 8, and one who used all 10", async () => {
      db.planCreatedAt = ago(8 * DAY);
      expect((await getCompanionAllowance("u1", "free", NOW)).verdict).toEqual({ allowed: false, reason: "window_ended" });
      db.planCreatedAt = ago(DAY);
      db.messages = 10;
      expect((await getCompanionAllowance("u1", "free", NOW)).verdict).toEqual({ allowed: false, reason: "total" });
    });

    it("gives Pro only the weekly limit, from the last 7 days of messages", async () => {
      db.messages = 400;
      db.planCreatedAt = ago(30 * DAY);
      db.recent = [ago(HOUR), ago(2 * HOUR), ago(3 * DAY), ago(5 * DAY)];
      const check = await getCompanionAllowance("u1", "pro", NOW);
      expect(check.verdict.allowed).toBe(true);
      expect(check.usage).toMatchObject({ dailyLimit: null, dailyLeft: null, weeklyLimit: 50, weeklyLeft: 46, totalLimit: null, totalLeft: null });
      expect(check.after).toMatchObject({ weeklyLeft: 45 });
    });

    it("blocks Pro at 50 in the week and reports when the next slot opens", async () => {
      db.recent = Array.from({ length: 50 }, (_, i) => ago(HOUR + i * HOUR));
      const check = await getCompanionAllowance("u1", "pro", NOW);
      expect(check.verdict).toMatchObject({ allowed: false, reason: "weekly" });
      // the 50th newest was sent 50 hours ago, so it is 168 hours old in 118 hours
      expect(check.usage.nextSlotAt).toBe(new Date(NOW.getTime() + 118 * HOUR).toISOString());
    });
  });
});
describe("server checks", () => {
  beforeEach(() => {
    db.subscription = null;
    db.analyses = 0;
    db.messages = 0;
    db.recent = [];
    db.planCreatedAt = null;
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
    db.messages = 10;
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
