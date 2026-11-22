import { prisma } from "@/lib/db/prisma";
import {
  canRunAnalysis,
  COMPANION_LIMITS,
  evaluateCompanionAllowance,
  freeWindowEnd,
  isProTier,
  isScheduleDayAllowed,
  isSubscriptionStatus,
  PLAN_WINDOW_ENDED,
  planDayNumber,
  proRequired,
  resolvePlan,
  usageSummary,
  type BillingStatus,
  type CompanionAllowance,
  type CompanionUsage,
  type Plan,
  type ProRequired,
} from "./plans";

/*
 * Server-side entitlements. The browser may hide or lock things, but every limit
 * is enforced here, in the routes and server actions that do the work.
 *
 * The checks return null when the request may go ahead, or a ProRequired value
 * when it may not. Routes answer that with HTTP 402 (proRequiredResponse);
 * server actions, which cannot set a status, return it as their result.
 */

export { resolvePlan, PLAN_LIMITS } from "./plans";
export type { BillingStatus, Plan, ProRequired } from "./plans";

/** The billing row for a user, or null when they never started a subscription. */
export function getSubscription(userId: string) {
  return prisma.subscription.findUnique({ where: { userId } });
}

export async function getUserPlan(userId: string, now: Date = new Date()): Promise<Plan> {
  return resolvePlan(await getSubscription(userId), now);
}

/**
 * Discovery analyses the user has completed. An attempt that failed before the
 * AI produced a condition does not count, so an outage never uses up the free one.
 */
export function countCompletedAnalyses(userId: string) {
  return prisma.clinicalReport.count({ where: { patientId: userId, conditionTitle: { not: null } } });
}

/**
 * Rehab Companion messages the user has sent, in total. Cleared chats and
 * messages answered by a guard still count: the rows are kept for this reason.
 */
export function countCompanionMessages(userId: string) {
  return prisma.chatMessage.count({ where: { patientId: userId, role: "user" } });
}

export async function getBillingStatus(userId: string, now: Date = new Date()): Promise<BillingStatus> {
  const [subscription, analyses, companionMessages] = await Promise.all([
    getSubscription(userId),
    countCompletedAnalyses(userId),
    countCompanionMessages(userId),
  ]);
  const plan = resolvePlan(subscription, now);
  return {
    plan,
    status: subscription && isSubscriptionStatus(subscription.status) ? subscription.status : null,
    // Only a window that is still open is reported: an ended one is just Free.
    currentPeriodEnd: plan === "pro" ? (subscription?.currentPeriodEnd?.toISOString() ?? null) : null,
    tier: plan === "pro" && isProTier(subscription?.tier) ? subscription.tier : null,
    usage: usageSummary(plan, { analyses, companionMessages }),
  };
}

/** A new Discovery analysis: one for Free, unlimited for Pro. */
export async function checkAnalysisAllowed(userId: string): Promise<ProRequired | null> {
  const plan = await getUserPlan(userId);
  if (plan === "pro") return null;
  return canRunAnalysis(plan, await countCompletedAnalyses(userId)) ? null : proRequired("reanalysis");
}

/**
 * Working on a plan day. Free: Days 1 to 7. Pro: the whole plan (`planDays` long, at least 30)
 * for as long as the purchased days last; once they run out the user is Free again, so Day 8
 * on asks for Pro. Day 1 is `startDateKey`. Past the end of the plan a Pro user has simply
 * finished it, which is not an upgrade problem.
 */
export async function checkScheduleDayAllowed(
  userId: string,
  startDateKey: string,
  dateKey: string,
  planDays: number = Infinity,
): Promise<ProRequired | { error: typeof PLAN_WINDOW_ENDED } | null> {
  const plan = await getUserPlan(userId);
  const dayNumber = planDayNumber(startDateKey, dateKey);
  if (isScheduleDayAllowed(plan, dayNumber, planDays)) return null;
  return plan === "pro" ? { error: PLAN_WINDOW_ENDED } : proRequired("schedule");
}

/**
 * Whether the user may send another Rehab Companion message, plus the numbers for the counter.
 * Read from stored messages (blocked and cleared ones are kept for this), so reloading or clearing
 * the chat resets nothing. Free: 3 in any rolling 24 hours, 10 in total, and only during the 7 days
 * after the plan was made. Pro: a fair-use limit of 50 in any rolling 7 days.
 */
/** The verdict and counter now, and the counter as it will stand once the message being checked is saved. */
export type CompanionCheck = CompanionAllowance & { after: CompanionUsage };

export async function getCompanionAllowance(userId: string, plan: Plan, now: Date = new Date()): Promise<CompanionCheck> {
  const free = plan === "free";
  // Free counts the last 24 hours (3), Pro the last 7 days (50): load just what the check needs.
  const since = new Date(now.getTime() - (free ? COMPANION_LIMITS.dayMs : COMPANION_LIMITS.weekMs));
  const [recent, sentTotal, latestPlan] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { patientId: userId, role: "user", createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      take: free ? COMPANION_LIMITS.perDay : COMPANION_LIMITS.proPerWeek,
      select: { createdAt: true },
    }),
    free ? countCompanionMessages(userId) : Promise.resolve(0),
    // The Free window is the 7 days after the plan was made, like the Week 1 schedule.
    free
      ? prisma.treatmentPlan.findFirst({
          where: { clinicalReport: { patientId: userId } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);
  const input = {
    plan,
    sentAt: recent.map((row) => row.createdAt),
    sentTotal,
    freeWindowEndsAt: latestPlan ? freeWindowEnd(latestPlan.createdAt) : null,
  };
  const allowance = evaluateCompanionAllowance(input, now);
  const after = evaluateCompanionAllowance({ ...input, sentAt: [now, ...input.sentAt], sentTotal: sentTotal + 1 }, now).usage;
  return { ...allowance, after };
}
/** Pain Override (stop, report, and the safe plan rebuild) has no check: it is free for every plan. */
/** HTTP 402 with `{ error: 'PRO_REQUIRED', feature }`. */
export function proRequiredResponse(blocked: ProRequired, headers: Record<string, string> = {}) {
  return Response.json(blocked, { status: 402, headers: { "Cache-Control": "no-store", ...headers } });
}
