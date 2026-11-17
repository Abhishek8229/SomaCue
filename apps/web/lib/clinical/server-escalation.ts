import { prisma } from "@/lib/db/prisma";
import { evaluateProgressEscalation, type Escalation } from "./assessment";

/**
 * Server-only. Re-evaluates a report's session history and locks it for
 * in-person care when the rules trigger. Returns the active escalation, if any.
 * Pain stops come from PainEvent rows, which a day reset never deletes.
 */
export async function checkProgressEscalation(
  reportId: string,
  todayKey: string,
): Promise<Escalation | null> {
  const report = await prisma.clinicalReport.findUnique({
    where: { id: reportId },
    select: {
      escalationKind: true,
      escalationReason: true,
      escalationEvidence: true,
      escalatedAt: true,
      dailyProgress: { select: { dateKey: true, feedback: true } },
      painEvents: { select: { dateKey: true, painType: true } },
    },
  });
  if (!report) return null;

  const existing = toEscalation(report);
  if (existing) return existing;

  const result = evaluateProgressEscalation(
    report.dailyProgress.map((row) => ({
      dateKey: row.dateKey,
      feedback:
        row.feedback === "relief" || row.feedback === "same" || row.feedback === "issue"
          ? row.feedback
          : null,
    })),
    report.painEvents,
    todayKey,
  );
  if (!result) return null;

  const escalatedAt = new Date();
  await prisma.clinicalReport.update({
    where: { id: reportId },
    data: {
      escalationKind: result.kind,
      escalationReason: result.reason,
      escalationEvidence: result.evidence,
      escalatedAt,
    },
  });
  return { ...result, escalatedAt: escalatedAt.toISOString() };
}

export function toEscalation(report: {
  escalationKind: string | null;
  escalationReason: string | null;
  escalationEvidence: string[];
  escalatedAt: Date | null;
}): Escalation | null {
  if (!report.escalatedAt || (report.escalationKind !== "triage" && report.escalationKind !== "progress")) {
    return null;
  }
  return {
    kind: report.escalationKind,
    reason: report.escalationReason ?? "This case needs an in-person medical evaluation.",
    evidence: report.escalationEvidence,
    escalatedAt: report.escalatedAt.toISOString(),
  };
}
