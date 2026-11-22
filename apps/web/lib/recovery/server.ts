import type { SessionUser } from "@/lib/auth/session";
import { planDayNumber } from "@/lib/billing/plans";
import { prisma } from "@/lib/db/prisma";
import {
  parseDynamicPrecautions,
  parsePermanentPrecautions,
  phaseIndexOf,
  weekOfPlan,
} from "@/lib/precautions/precautions";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import { extractChatInsight } from "./chatInsights";
import {
  analysisEvent,
  chatInsightEvent,
  deriveRecoveryEvents,
  mergeRecoveryEvents,
  planEvent,
  summarizeTrends,
  type DerivedReport,
  type RecoveryEvent,
  type RecoveryKind,
  type RecoveryMeta,
  type RecoveryTimeline,
} from "./timeline";

/*
 * Server-only. Writing to the Recovery Timeline never throws: it is a record kept beside the care, and
 * a failure here must not undo or block the feedback, Pain Override report, chat reply or plan that
 * triggered it. Reading merges the log with the history the app already stored.
 */

/** Saves one event. The same fact (same key) is only ever saved once. */
export async function recordRecoveryEvent(patientId: string, event: RecoveryEvent): Promise<boolean> {
  try {
    const data = {
      patientId,
      clinicalReportId: event.reportId,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      dateKey: event.dateKey,
      occurredAt: new Date(event.occurredAt),
      meta: event.meta ?? undefined,
      dedupeKey: event.key,
    };
    await prisma.recoveryEvent.upsert({
      where: { patientId_dedupeKey: { patientId, dedupeKey: event.key } },
      create: data,
      update: {},
    });
    return true;
  } catch (error) {
    console.error("[SomaCue timeline] Could not log a recovery event.", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Builds and saves events. The builder runs inside the guard too, so odd input can never break the caller.
 * Never throws.
 */
export async function logRecoveryEvents(patientId: string, build: () => RecoveryEvent | readonly RecoveryEvent[]): Promise<void> {
  try {
    const built = build();
    const events: readonly RecoveryEvent[] = Array.isArray(built) ? built : [built as RecoveryEvent];
    for (const event of events) await recordRecoveryEvent(patientId, event);
  } catch (error) {
    console.error("[SomaCue timeline] Could not log a recovery event.", error instanceof Error ? error.message : error);
  }
}

/** A new analysis was run. The patient's earliest report is their first analysis. */
export async function recordAnalysis(
  patientId: string,
  report: { id: string; createdAt: Date; primarySymptoms: string; conditionTitle: string | null; conditionSummary: string | null },
): Promise<void> {
  try {
    const earliest = await prisma.clinicalReport.findFirst({ where: { patientId }, orderBy: { createdAt: "asc" }, select: { id: true } });
    await recordRecoveryEvent(patientId, analysisEvent({ ...report, isFirst: !earliest || earliest.id === report.id }));
  } catch (error) {
    console.error("[SomaCue timeline] Could not log the analysis.", error instanceof Error ? error.message : error);
  }
}

export async function recordPlan(
  patientId: string,
  input: { reportId: string; createdAt: Date; plan: Pick<StoredTreatmentPlan, "durationMonths" | "phases" | "steps">; rerun: boolean },
): Promise<void> {
  await logRecoveryEvents(patientId, () => planEvent(input));
}

/**
 * Looks at a message the patient sent to the Rehab Companion and logs it if it describes their own
 * symptoms, pain triggers, movement trouble or progress. No AI call, so no extra tokens or latency.
 * A warning-sign message (`redFlag`) is always logged, even when its wording is not a plain symptom statement.
 */
export async function recordChatInsight(
  patientId: string,
  message: { id: string; reportId: string | null; content: string; createdAt: Date },
  options: { redFlag?: boolean } = {},
): Promise<boolean> {
  try {
    const insight = extractChatInsight(message.content) ?? (options.redFlag ? { category: "new_symptom" as const, text: message.content } : null);
    if (!insight) return false;
    return await recordRecoveryEvent(
      patientId,
      chatInsightEvent({ messageId: message.id, reportId: message.reportId, category: insight.category, text: insight.text, at: message.createdAt }),
    );
  } catch (error) {
    console.error("[SomaCue timeline] Could not log the chat insight.", error instanceof Error ? error.message : error);
    return false;
  }
}

const READ_LIMITS = { reports: 100, progress: 1500, pain: 500, events: 3000 } as const;

function asPlan(value: unknown): StoredTreatmentPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<StoredTreatmentPlan>;
  return typeof plan.durationMonths === "number" && Array.isArray(plan.phases) && Array.isArray(plan.steps) ? (value as StoredTreatmentPlan) : null;
}

function asMeta(value: unknown): RecoveryMeta | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecoveryMeta) : null;
}

/** The patient's whole timeline: the log merged with the history already stored. */
export async function getRecoveryTimeline(user: Pick<SessionUser, "id" | "name" | "email">, now: Date = new Date()): Promise<RecoveryTimeline> {
  const todayKey = now.toISOString().slice(0, 10);

  const [reports, progress, painEvents, logged] = await Promise.all([
    prisma.clinicalReport.findMany({
      where: { patientId: user.id },
      orderBy: { createdAt: "desc" },
      take: READ_LIMITS.reports,
      include: { treatmentPlan: { select: { routine: true, createdAt: true, permanentPrecautions: true, dynamicPrecautions: true } } },
    }),
    prisma.dailyProgress.findMany({ where: { patientId: user.id }, orderBy: { dateKey: "asc" }, take: READ_LIMITS.progress }),
    prisma.painEvent.findMany({ where: { patientId: user.id }, orderBy: { createdAt: "asc" }, take: READ_LIMITS.pain }),
    prisma.recoveryEvent.findMany({ where: { patientId: user.id }, orderBy: { occurredAt: "asc" }, take: READ_LIMITS.events }),
  ]);

  const derivedReports: DerivedReport[] = reports.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    primarySymptoms: row.primarySymptoms,
    conditionTitle: row.conditionTitle,
    conditionSummary: row.conditionSummary,
    escalatedAt: row.escalatedAt,
    escalationReason: row.escalationReason,
    plan: asPlan(row.treatmentPlan?.routine),
    planCreatedAt: row.treatmentPlan?.createdAt ?? null,
    dynamic: parseDynamicPrecautions(row.treatmentPlan?.dynamicPrecautions),
  }));

  const derived = deriveRecoveryEvents(
    {
      reports: derivedReports,
      progress: progress.map((row) => ({
        reportId: row.clinicalReportId,
        dateKey: row.dateKey,
        completedExercises: row.completedExercises,
        completedAt: row.completedAt,
        feedback: row.feedback,
        notes: row.notes,
        discomfortExercises: row.discomfortExercises,
        discomfortDetails: row.discomfortDetails,
        rescheduledAt: row.rescheduledAt,
        updatedAt: row.updatedAt,
      })),
      painEvents: painEvents.map((row) => ({
        id: row.id,
        reportId: row.clinicalReportId,
        dateKey: row.dateKey,
        painType: row.painType,
        regions: row.regions,
        exerciseNames: row.exerciseNames,
        details: row.details,
        createdAt: row.createdAt,
        rescheduledAt: row.rescheduledAt,
      })),
    },
    todayKey,
  );

  const loggedEvents: RecoveryEvent[] = logged.map((row) => ({
    key: row.dedupeKey,
    kind: row.kind as RecoveryKind,
    title: row.title,
    detail: row.detail,
    occurredAt: row.occurredAt.toISOString(),
    dateKey: row.dateKey,
    reportId: row.clinicalReportId,
    meta: asMeta(row.meta),
  }));

  const events = mergeRecoveryEvents(loggedEvents, derived);

  // The current state comes from the newest intake.
  const latest = reports[0] ?? null;
  const latestPlan = asPlan(latest?.treatmentPlan?.routine);
  const startDateKey = latestPlan ? (latestPlan.startDateKey ?? latest?.treatmentPlan?.createdAt.toISOString().slice(0, 10) ?? null) : null;
  const dayNumber = startDateKey ? Math.max(1, planDayNumber(startDateKey, todayKey)) : null;
  const permanent = parsePermanentPrecautions(latest?.treatmentPlan?.permanentPrecautions);
  const dynamic = parseDynamicPrecautions(latest?.treatmentPlan?.dynamicPrecautions);

  return {
    patient: { name: user.name, email: user.email },
    generatedAt: now.toISOString(),
    events,
    trends: summarizeTrends(events),
    condition: latest
      ? {
          title: latest.conditionTitle,
          summary: latest.conditionSummary,
          symptoms: latest.primarySymptoms,
          startedAt: (reports[reports.length - 1] ?? latest).createdAt.toISOString(),
          requiresInPersonCare: latest.requiresInPersonCare,
          careReason: latest.careReason,
        }
      : null,
    plan:
      latestPlan && dayNumber !== null
        ? {
            durationMonths: latestPlan.durationMonths,
            phases: latestPlan.phases.map((phase) => ({ phase: phase.phase, tagline: phase.tagline })),
            startDateKey,
            dayNumber,
            weekNumber: weekOfPlan(dayNumber),
            phaseName: latestPlan.phases[phaseIndexOf(dayNumber, latestPlan.phases.length)]?.phase ?? null,
          }
        : null,
    precautions: permanent || dynamic ? { permanent: permanent ?? [], dynamic: dynamic?.items ?? [], dynamicBadge: dynamic?.badge ?? null } : null,
  };
}
