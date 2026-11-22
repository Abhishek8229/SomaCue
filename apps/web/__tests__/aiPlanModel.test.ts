// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: ai.generateObject }));

import { generateFinalRoutine, generateTriageQuiz } from "@/actions/generatePlan";

const NO_FILES = { scans: [], prescriptions: [], uncategorized: [] };
const RESULT = {
  questions: [],
  assessment: { conditionTitle: "x", conditionSummary: "y", manageableWithGuidedRehab: true, safetyReasoning: "z", redFlags: [] },
};

beforeEach(() => {
  ai.generateObject.mockReset();
  ai.generateObject.mockResolvedValue({ object: RESULT });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("plan generation reads the model from AI_MODEL", () => {
  it("calls the model named in AI_MODEL, with no model written in the code", async () => {
    vi.stubEnv("AI_BASE_URL", "https://ai.example.test/v1");
    vi.stubEnv("AI_API_KEY", "key-123");
    vi.stubEnv("AI_MODEL", "vendor/some-model");

    await generateTriageQuiz("Low back pain after lifting", NO_FILES);

    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    expect((ai.generateObject.mock.calls[0][0].model as { modelId: string }).modelId).toBe("vendor/some-model");
  });

  it("fails without calling any model, and logs which setting is missing, when AI_MODEL is not set", async () => {
    vi.stubEnv("AI_BASE_URL", "https://ai.example.test/v1");
    vi.stubEnv("AI_API_KEY", "key-123");
    vi.stubEnv("AI_MODEL", "");

    const result = await generateTriageQuiz("Low back pain after lifting", NO_FILES);

    expect(result).toEqual({ success: false, error: "AI_PROVIDER_FAILED" });
    expect(ai.generateObject).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: expect.stringContaining("set AI_MODEL in .env") }));
  });
});

describe("plan generation returns the precautions in the same call", () => {
  const ROUTINE = { durationMonths: 1, phases: [{ phase: "Calm", tagline: "Settle it" }], steps: [], schedule: { horizonDays: 1, days: [] } };

  it("asks for both lists in the plan schema and prompt, and hands them back apart from the routine", async () => {
    vi.stubEnv("AI_BASE_URL", "https://ai.example.test/v1");
    vi.stubEnv("AI_API_KEY", "key-123");
    vi.stubEnv("AI_MODEL", "vendor/some-model");
    ai.generateObject.mockResolvedValue({
      object: { ...ROUTINE, permanentPrecautions: ["Avoid X.", "Keep Y.", "Stop for Z."], dynamicPrecautions: ["Week one A.", "Week one B.", "Week one C."] },
    });

    const result = await generateFinalRoutine("Low back pain", NO_FILES, {});

    expect(ai.generateObject).toHaveBeenCalledTimes(1);
    const call = ai.generateObject.mock.calls[0][0];
    expect(Object.keys(call.schema.shape ?? call.schema._def?.schema?.shape ?? {})).toEqual(expect.arrayContaining(["permanentPrecautions", "dynamicPrecautions"]));
    expect(call.system).toMatch(/permanentPrecautions/);
    expect(call.system).toMatch(/dynamicPrecautions/);
    expect(result).toEqual({
      success: true,
      routine: ROUTINE,
      precautions: { permanentPrecautions: ["Avoid X.", "Keep Y.", "Stop for Z."], dynamicPrecautions: ["Week one A.", "Week one B.", "Week one C."] },
    });
  });
});