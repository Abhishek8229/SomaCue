import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  planLookup: vi.fn(),
  /** an active Pro subscription lets a report be re-run; null is Free */
  subscription: null as null | { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null },
  logEvent: vi.fn(),
  generateFinalRoutine: vi.fn(),
  existingPlan: false,
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => ({ id: "patient-1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/kinematics/plan-repair", () => ({ repairPlan: async (routine: unknown) => routine }));
vi.mock("@/actions/generatePlan", () => ({ generateTriageQuiz: vi.fn(), generateFinalRoutine: mocks.generateFinalRoutine }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    triageQuiz: {
      findUnique: async () => ({
        id: "quiz-1",
        clinicalReportId: "report-1",
        questions: [{ id: "pain_level", question: "How bad is the pain?", answerType: "short_text" }],
        clinicalReport: {
          id: "report-1",
          patientId: "patient-1",
          primarySymptoms: "Low back pain after lifting",
          fileUrls: [],
          scanUrls: [],
          prescriptionUrls: [],
          escalationKind: null,
          escalationReason: null,
          escalationEvidence: [],
          escalatedAt: null,
        },
      }),
    },
    quizAnswer: { upsert: async () => ({}) },
    clinicalReport: { update: async () => ({}), count: async () => 1 },
    subscription: { findUnique: async () => mocks.subscription },
    treatmentPlan: { upsert: mocks.upsert, findUnique: mocks.planLookup },
    recoveryEvent: { upsert: mocks.logEvent },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  },
}));

import { completeTriageQuiz } from "@/actions/intake";
import { isUnread } from "@/lib/precautions/precautions";

const ROUTINE = {
  durationMonths: 1,
  phases: [{ phase: "Calm", tagline: "Settle it" }],
  steps: [],
  schedule: { horizonDays: 1, days: [] },
};

const ai = (permanent: string[], dynamic: string[]) => ({
  success: true,
  routine: ROUTINE,
  precautions: { permanentPrecautions: permanent, dynamicPrecautions: dynamic },
});

const answers = { pain_level: "6 out of 10" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({ id: "plan-1", createdAt: new Date("2026-11-01T08:10:00.000Z") });
  mocks.planLookup.mockResolvedValue(null);
  mocks.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
  mocks.logEvent.mockResolvedValue({});
});

describe("analysis saves the precautions with the plan", () => {
  it("stores the permanent list and the first dynamic list on the plan row, from the one AI response", async () => {
    mocks.generateFinalRoutine.mockResolvedValue(
      ai(["Avoid deep forward bends.", "Keep a neutral spine.", "Stop for leg numbness."], ["Use small ranges.", "Pause if pain spreads.", "Rest on flare-ups."]),
    );
    const result = await completeTriageQuiz("report-1", "quiz-1", answers);

    // the plan is generated once; the precautions are not a second call
    expect(mocks.generateFinalRoutine).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const call = mocks.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ clinicalReportId: "report-1" });
    for (const data of [call.create, call.update]) {
      expect(data.permanentPrecautions).toEqual(["Avoid deep forward bends.", "Keep a neutral spine.", "Stop for leg numbness."]);
      expect(data.dynamicPrecautions).toMatchObject({
        items: ["Use small ranges.", "Pause if pain spreads.", "Rest on flare-ups."],
        badge: "Week 1 • Active",
        kind: "initial",
        weekNumber: 1,
        phaseIndex: 0,
      });
      expect(isUnread(data.dynamicPrecautions)).toBe(false);
    }
    // the routine itself carries no precaution fields
    expect(call.create.routine).toEqual(ROUTINE);
    expect(result).toMatchObject({ success: true, treatmentPlanId: "plan-1", precautions: { permanent: expect.any(Array), dynamic: { kind: "initial" } } });
  });

  it("replaces both lists when the analysis is run again", async () => {
    mocks.generateFinalRoutine.mockResolvedValue(ai(["Old one.", "Old two.", "Old three."], ["Old a.", "Old b.", "Old c."]));
    await completeTriageQuiz("report-1", "quiz-1", answers);
    mocks.planLookup.mockResolvedValue({ routine: ROUTINE }); // the plan now exists: this is a Pro re-run
    mocks.generateFinalRoutine.mockResolvedValue(ai(["New one.", "New two.", "New three."], ["New a.", "New b.", "New c."]));
    await completeTriageQuiz("report-1", "quiz-1", answers);

    const update = mocks.upsert.mock.calls[1][0].update;
    expect(update.permanentPrecautions).toEqual(["New one.", "New two.", "New three."]);
    expect(update.dynamicPrecautions.items).toEqual(["New a.", "New b.", "New c."]);
    expect(update.dynamicPrecautions.kind).toBe("initial");
    // a re-run keeps the plan's original creation time, so it cannot restart the free window
    expect(update).not.toHaveProperty("createdAt");
  });

  it("keeps each list to 3 to 5 bullets whatever the AI returns", async () => {
    mocks.generateFinalRoutine.mockResolvedValue(
      ai(["Only one."], ["a", "b", "c", "d", "e", "f", "g", "a"]),
    );
    await completeTriageQuiz("report-1", "quiz-1", answers);
    const { create } = mocks.upsert.mock.calls[0][0];
    expect(create.permanentPrecautions).toHaveLength(3);
    expect(create.permanentPrecautions[0]).toBe("Only one.");
    expect(create.dynamicPrecautions.items).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("saves nothing when the AI fails, so no plan is left half made", async () => {
    mocks.generateFinalRoutine.mockResolvedValue({ success: false, error: "AI_PROVIDER_FAILED" });
    const result = await completeTriageQuiz("report-1", "quiz-1", answers);
    expect(result).toEqual({ success: false, error: "AI_PROVIDER_FAILED" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("analysis puts the plan on the Recovery Timeline", () => {
  const logged = () => mocks.logEvent.mock.calls.map((call) => call[0].create as Record<string, unknown>);

  it("logs the new plan, once, with the plan's own time as its key", async () => {
    mocks.generateFinalRoutine.mockResolvedValue(ai(["One.", "Two.", "Three."], ["a", "b", "c"]));
    await completeTriageQuiz("report-1", "quiz-1", answers);

    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({
      patientId: "patient-1",
      clinicalReportId: "report-1",
      kind: "plan",
      title: "Treatment plan created",
      dedupeKey: `plan:report-1:${new Date("2026-11-01T08:10:00.000Z").getTime()}`,
    });
  });

  it("calls a second plan on the same report a re-run, and keeps both entries", async () => {
    mocks.generateFinalRoutine.mockResolvedValue(ai(["One.", "Two.", "Three."], ["a", "b", "c"]));
    await completeTriageQuiz("report-1", "quiz-1", answers);
    mocks.planLookup.mockResolvedValue({ id: "plan-1" });
    mocks.upsert.mockResolvedValue({ id: "plan-1", createdAt: new Date("2026-11-08T09:00:00.000Z") });
    await completeTriageQuiz("report-1", "quiz-1", answers);

    expect(logged().map((row) => row.title)).toEqual(["Treatment plan created", "Plan updated after re-running the analysis"]);
    expect(new Set(logged().map((row) => row.dedupeKey)).size).toBe(2);
  });

  it("still saves the plan if the timeline cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.logEvent.mockRejectedValue(new Error("database unavailable"));
    mocks.generateFinalRoutine.mockResolvedValue(ai(["One.", "Two.", "Three."], ["a", "b", "c"]));
    const result = await completeTriageQuiz("report-1", "quiz-1", answers);
    expect(result).toMatchObject({ success: true, treatmentPlanId: "plan-1" });
  });
});