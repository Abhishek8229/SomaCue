// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: ai.generateObject }));

import { generateTriageQuiz } from "@/actions/generatePlan";

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
