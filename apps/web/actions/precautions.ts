"use server";

import { ensurePlanPrecautions, markDynamicPrecautionsSeen } from "@/lib/precautions/server";
import type { ActionFailure } from "@/lib/progress/dailyProgress";
import { fail, loadOwnedPlan, validateDateKey } from "@/lib/progress/server-plan";

/**
 * The user opened the Dynamic tab: the update dot goes away, and stays away until the precautions change again.
 * A plan saved before precautions existed is given its precautions first, so what the card showed is what is stored.
 * `todayKey` is the browser's local date; the server's date is used when it is missing or not a near date.
 */
export async function markPrecautionsSeen(
  reportId: string,
  todayKey?: string,
): Promise<{ success: true; seenAt: string | null } | ActionFailure> {
  const owned = await loadOwnedPlan(reportId);
  if ("error" in owned) return fail(owned.error);
  const usableKey = todayKey && !validateDateKey(todayKey) ? todayKey : new Date().toISOString().slice(0, 10);
  await ensurePlanPrecautions({
    treatmentPlanId: owned.treatmentPlanId,
    reportId,
    plan: owned.plan,
    startDateKey: owned.startDateKey,
    todayKey: usableKey,
  });
  const seen = await markDynamicPrecautionsSeen(owned.treatmentPlanId);
  return { success: true, seenAt: seen?.seenAt ?? null };
}
