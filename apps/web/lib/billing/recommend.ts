import { prisma } from "@/lib/db/prisma";
import { recommendedTier, type ProTier } from "./plans";

/**
 * The Pro tier that covers the user's latest rehab plan, or null before they have one. The plan
 * length is the AI's own durationMonths from their analysis, so this follows their assessment.
 */
export async function getRecommendedTier(userId: string): Promise<ProTier | null> {
  const latest = await prisma.treatmentPlan.findFirst({
    where: { clinicalReport: { patientId: userId } },
    orderBy: { createdAt: "desc" },
    select: { routine: true },
  });
  const routine = latest?.routine;
  if (!routine || typeof routine !== "object" || Array.isArray(routine)) return null;
  const months = (routine as { durationMonths?: unknown }).durationMonths;
  return typeof months === "number" ? recommendedTier(months) : null;
}
