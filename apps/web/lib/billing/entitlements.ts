import { prisma } from "@/lib/db/prisma";
import {
  canRunAnalysis,
  canSendCompanionMessage,
  COMPANION_LIMITS,
  evaluateProCompanionLimits,
  isProTier,
  isScheduleDayAllowed,
  isSubscriptionStatus,
  PLAN_WINDOW_ENDED,
  planDayNumber,
  proRequired,
  resolvePlan,
  usageSummary,
  type BillingStatus,
  type CompanionLimitResult,
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

/** The next Rehab Companion message: 3 in total for Free, unlimited for Pro. */
export async function checkCompanionAllowed(userId: string): Promise<ProRequired | null> {
  const plan = await getUserPlan(userId);
  if (plan === "pro") return null;
  return canSendCompanionMessage(plan, await countCompanionMessages(userId)) ? null : proRequired("companion");
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
 * Pro fair use for the Rehab Companion, from the times of the user's messages in the last 24
 * hours (blocked and cleared ones count; they are kept for this). Free has its own total and
 * is not checked here.
 */
export async function checkProCompanionLimits(userId: string, now: Date = new Date()): Promise<CompanionLimitResult> {
  const since = new Date(now.getTime() - COMPANION_LIMITS.proWindowMs);
  const recent = await prisma.chatMessage.findMany({
    where: { patientId: userId, role: "user", createdAt: { gt: since } },
    orderBy: { createdAt: "desc" },
    take: COMPANION_LIMITS.proWindowMessages,
    select: { createdAt: true },
  });
  return evaluateProCompanionLimits(
    recent.map((row) => row.createdAt),
    now,
  );
}

/** Pain Override (stop, report, and the safe plan rebuild) has no check: it is free for every plan. */
/** HTTP 402 with `{ error: 'PRO_REQUIRED', feature }`. */
export function proRequiredResponse(blocked: ProRequired, headers: Record<string, string> = {}) {
  return Response.json(blocked, { status: 402, headers: { "Cache-Control": "no-store", ...headers } });
}
