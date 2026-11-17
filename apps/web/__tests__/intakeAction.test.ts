import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, update, quizCreate, generateTriageQuiz } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  quizCreate: vi.fn(),
  generateTriageQuiz: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => ({ id: "patient-1" }) }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { clinicalReport: { create, update }, triageQuiz: { create: quizCreate } },
}));
vi.mock("@/actions/generatePlan", () => ({ generateTriageQuiz, generateFinalRoutine: vi.fn() }));
vi.mock("@/lib/kinematics/plan-repair", () => ({ repairPlan: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitIntakeForm } from "@/actions/intake";

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
