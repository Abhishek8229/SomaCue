import { beforeEach, describe, expect, it, vi } from "vitest";

const plan = vi.hoisted(() => ({
  subscription: { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null } as {
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: Date | null;
  } | null,
  /** analyses the user has already completed */
  analyses: 0,
}));

const { create, update, quizCreate, generateTriageQuiz, generateFinalRoutine, repairPlan, planFind, planUpsert, answerUpsert } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  quizCreate: vi.fn(),
  generateTriageQuiz: vi.fn(),
  generateFinalRoutine: vi.fn(),
  repairPlan: vi.fn(),
  planFind: vi.fn(),
  planUpsert: vi.fn(),
  answerUpsert: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => ({ id: "patient-1" }) }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    clinicalReport: { create, update, count: async () => plan.analyses },
    triageQuiz: {
      create: quizCreate,
      findUnique: async () => ({
        id: "quiz-1",
        clinicalReportId: "report-1",
        questions: QUIZ_QUESTIONS,
        clinicalReport: { id: "report-1", patientId: "patient-1", primarySymptoms: "Low back pain", fileUrls: [], scanUrls: [], prescriptionUrls: [], escalationKind: null, escalationReason: null, escalationEvidence: [], escalatedAt: null },
      }),
    },
    quizAnswer: { upsert: answerUpsert },
    treatmentPlan: { findUnique: planFind, upsert: planUpsert },
    recoveryEvent: { upsert: async () => ({}) },
    subscription: { findUnique: async () => plan.subscription },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  },
}));
vi.mock("@/actions/generatePlan", () => ({ generateTriageQuiz, generateFinalRoutine }));
vi.mock("@/lib/kinematics/plan-repair", () => ({ repairPlan }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { completeTriageQuiz, submitIntakeForm } from "@/actions/intake";

const QUIZ_QUESTIONS = [{ id: "pain_level", question: "How bad?", answerType: "short_text" }];

const SCAN = "/uploads/12f80538-4e07-4160-82c1-48d2dccb3612.jpeg";
const RX = "https://acct.blob.core.windows.net/patient-scans/279a4232-b42d-47c3-b15f-c9d658848d8d.pdf";

const QUESTIONS = [{ id: "pain_level", question: "How bad?", answerType: "short_text" }];
const safeAssessment = {
  conditionTitle: "Patellofemoral pain syndrome",
  conditionSummary: "Irritation behind the kneecap. It often flares with walking and stairs.",
  manageableWithGuidedRehab: true,
  safetyReasoning: "No warning signs were reported.",
  redFlags: [],
};

function form(entries: [string, string][], symptoms = "Right knee pain after long walks") {
  const data = new FormData();
  data.set("primarySymptoms", symptoms);
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("submitIntakeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plan.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
    plan.analyses = 0;
    create.mockResolvedValue({ id: "report-1" });
    quizCreate.mockResolvedValue({ id: "quiz-1" });
    update.mockResolvedValue({});
    generateTriageQuiz.mockResolvedValue({ success: true, questions: QUESTIONS, assessment: safeAssessment });
  });

  it("rejects an intake with no prescription and no acknowledgment", async () => {
    await expect(submitIntakeForm(form([["scanUrl", SCAN]]))).rejects.toThrow(/limits of AI analysis/);
    expect(create).not.toHaveBeenCalled();
  });

  it("stores the acknowledgment time when there is no prescription", async () => {
    await submitIntakeForm(form([["scanUrl", SCAN], ["aiDisclaimerAccepted", "true"]]));

    const data = create.mock.calls[0][0].data;
    expect(data.scanUrls).toEqual([SCAN]);
    expect(data.prescriptionUrls).toEqual([]);
    expect(data.fileUrls).toEqual([SCAN]);
    expect(data.aiDisclaimerAcceptedAt).toBeInstanceOf(Date);
  });

  it("saves categorized files and passes them to the triage AI", async () => {
    await submitIntakeForm(form([["scanUrl", SCAN], ["prescriptionUrl", RX]]));

    const data = create.mock.calls[0][0].data;
    expect(data.scanUrls).toEqual([SCAN]);
    expect(data.prescriptionUrls).toEqual([RX]);
    expect(data.fileUrls).toEqual([SCAN, RX]);
    expect(data.aiDisclaimerAcceptedAt).toBeNull();
    expect(generateTriageQuiz).toHaveBeenCalledWith("Right knee pain after long walks", {
      scans: [SCAN],
      prescriptions: [RX],
      uncategorized: [],
    });
  });

  it("rejects file URLs that did not come from the upload action", async () => {
    await expect(
      submitIntakeForm(form([["prescriptionUrl", "http://169.254.169.254/latest/meta-data"]])),
    ).rejects.toThrow(/could not be verified/);
    expect(create).not.toHaveBeenCalled();
  });

  it("saves the detected condition with a source based on the uploads", async () => {
    const result = await submitIntakeForm(form([["scanUrl", SCAN], ["prescriptionUrl", RX]]));

    expect(update.mock.calls[0][0].data).toMatchObject({
      conditionTitle: "Patellofemoral pain syndrome",
      conditionSource: "reports_and_scans",
      requiresInPersonCare: false,
    });
    expect(update.mock.calls[0][0].data.escalatedAt).toBeUndefined();
    expect(result).toMatchObject({ quizId: "quiz-1", escalation: null });
  });

  it("locks the case and skips the quiz when the AI says it needs in-person care", async () => {
    generateTriageQuiz.mockResolvedValue({
      success: true,
      questions: QUESTIONS,
      assessment: {
        ...safeAssessment,
        conditionTitle: "Suspected tibial plateau fracture",
        manageableWithGuidedRehab: false,
        safetyReasoning: "The X-ray report describes a possible fracture line.",
        redFlags: ["Possible fracture on imaging"],
      },
    });

    const result = await submitIntakeForm(form([["scanUrl", SCAN], ["aiDisclaimerAccepted", "true"]]));

    expect(quizCreate).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toMatchObject({
      conditionSource: "scans_and_symptoms",
      requiresInPersonCare: true,
      escalationKind: "triage",
      escalationReason: "The X-ray report describes a possible fracture line.",
      escalationEvidence: ["Possible fracture on imaging"],
    });
    expect(result).toMatchObject({ quizId: null, escalation: { kind: "triage" } });
  });

  it("escalates on red-flag symptoms even if the AI misses them", async () => {
    const result = await submitIntakeForm(
      form([["aiDisclaimerAccepted", "true"]], "Back pain and I lost bladder control this morning"),
    );

    expect(quizCreate).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toMatchObject({
      conditionSource: "symptoms_only",
      requiresInPersonCare: true,
      escalationEvidence: ["Loss of bladder or bowel control"],
    });
    expect(result).toMatchObject({ escalation: { kind: "triage" } });
  });

  it("still escalates red-flag symptoms when the AI is unavailable", async () => {
    generateTriageQuiz.mockResolvedValue({ success: false, error: "AI_PROVIDER_FAILED" });

    const result = await submitIntakeForm(
      form([["aiDisclaimerAccepted", "true"]], "Numbness in my groin and leg weakness getting worse"),
    );
    expect(result).toMatchObject({ success: true, escalation: { kind: "triage" } });

    generateTriageQuiz.mockResolvedValue({ success: false, error: "AI_PROVIDER_FAILED" });
    await expect(
      submitIntakeForm(form([["aiDisclaimerAccepted", "true"]])),
    ).resolves.toEqual({ success: false, error: "AI_PROVIDER_FAILED" });
  });
});

describe("submitIntakeForm: Discovery analyses by plan", () => {
  const submit = () => submitIntakeForm(form([["scanUrl", SCAN], ["prescriptionUrl", RX]]));

  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: "report-1" });
    quizCreate.mockResolvedValue({ id: "quiz-1" });
    update.mockResolvedValue({});
    generateTriageQuiz.mockResolvedValue({ success: true, questions: QUESTIONS, assessment: safeAssessment });
    plan.subscription = null; // Free
    plan.analyses = 0;
  });

  it("lets a Free user run their first analysis", async () => {
    plan.analyses = 0;
    const result = await submit();
    expect(result).toMatchObject({ success: true, reportId: "report-1" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses a Free user's second analysis with PRO_REQUIRED, before anything is saved or sent to the AI", async () => {
    plan.analyses = 1;
    const result = await submit();
    expect(result).toEqual({ success: false, error: "PRO_REQUIRED", feature: "reanalysis" });
    expect(create).not.toHaveBeenCalled();
    expect(generateTriageQuiz).not.toHaveBeenCalled();
  });

  it("lets Pro re-run the analysis as often as they like", async () => {
    plan.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
    plan.analyses = 12;
    expect(await submit()).toMatchObject({ success: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("goes back to one analysis once a cancelled subscription's paid period is over", async () => {
    plan.analyses = 2;
    plan.subscription = { status: "cancelled", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - 60_000) };
    expect(await submit()).toMatchObject({ success: false, error: "PRO_REQUIRED" });
    plan.subscription = { status: "cancelled", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() + 86_400_000) };
    expect(await submit()).toMatchObject({ success: true });
  });
});

describe("completeTriageQuiz: replaying a finished quiz", () => {
  const ROUTINE = { durationMonths: 2, phases: [{ phase: "Calm", tagline: "Settle it" }], steps: [], schedule: { horizonDays: 1, days: [] } };
  const ORIGINAL_START = "2026-11-10";
  const replay = () => completeTriageQuiz("report-1", "quiz-1", { pain_level: "6 out of 10" });

  beforeEach(() => {
    vi.clearAllMocks();
    plan.subscription = null; // Free
    plan.analyses = 1; // the report being replayed is already an analysis
    planFind.mockResolvedValue(null);
    planUpsert.mockResolvedValue({ id: "plan-1", createdAt: new Date("2026-11-10T08:00:00Z") });
    answerUpsert.mockResolvedValue({});
    repairPlan.mockImplementation(async (routine: unknown) => routine);
    generateFinalRoutine.mockResolvedValue({
      success: true,
      routine: ROUTINE,
      precautions: { permanentPrecautions: ["One.", "Two.", "Three."], dynamicPrecautions: ["a", "b", "c"] },
    });
  });

  it("makes the first plan for a report, for Free, as usual", async () => {
    plan.analyses = 0;
    expect(await replay()).toMatchObject({ success: true, treatmentPlanId: "plan-1" });
    expect(generateFinalRoutine).toHaveBeenCalledTimes(1);
  });

  it("refuses a Free user a second plan for the same report with PRO_REQUIRED, before saving answers or calling the AI", async () => {
    planFind.mockResolvedValue({ routine: { ...ROUTINE, startDateKey: ORIGINAL_START } });
    expect(await replay()).toEqual({ success: false, error: "PRO_REQUIRED", feature: "reanalysis" });
    expect(generateFinalRoutine).not.toHaveBeenCalled();
    expect(answerUpsert).not.toHaveBeenCalled();
    expect(planUpsert).not.toHaveBeenCalled();
  });

  it("refuses it again after a cancelled subscription's paid period is over", async () => {
    planFind.mockResolvedValue({ routine: { ...ROUTINE, startDateKey: ORIGINAL_START } });
    plan.subscription = { status: "cancelled", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - 60_000) };
    expect(await replay()).toMatchObject({ success: false, error: "PRO_REQUIRED" });
    expect(planUpsert).not.toHaveBeenCalled();
  });

  it("refuses the replay if the existing-plan lookup fails, rather than letting it through", async () => {
    planFind.mockRejectedValue(new Error("database unavailable"));
    await expect(replay()).rejects.toThrow("database unavailable");
    expect(generateFinalRoutine).not.toHaveBeenCalled();
    expect(planUpsert).not.toHaveBeenCalled();
  });

  it("lets Pro re-run it, but keeps the plan's creation time and Day 1, so the window cannot restart", async () => {
    plan.subscription = { status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null };
    planFind.mockResolvedValue({ routine: { ...ROUTINE, startDateKey: ORIGINAL_START } });
    const result = await replay();
    expect(result).toMatchObject({ success: true, routine: { startDateKey: ORIGINAL_START } });
    expect(generateFinalRoutine).toHaveBeenCalledTimes(1);

    const { update, create } = planUpsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("createdAt");
    expect(update.routine.startDateKey).toBe(ORIGINAL_START);
    expect(create).not.toHaveProperty("createdAt");
  });

  it("leaves a first plan's routine alone when there was no earlier Day 1 to keep", async () => {
    plan.analyses = 0;
    await replay();
    expect(planUpsert.mock.calls[0][0].create.routine).toEqual(ROUTINE);
  });
});