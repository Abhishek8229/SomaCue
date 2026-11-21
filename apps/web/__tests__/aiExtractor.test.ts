// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateObject: ai.generateObject }));

import { AiConfigError } from "@/lib/ai/client";
import { extractClinicalDiagnosis } from "@/lib/ai/extractor";

beforeEach(() => {
  ai.generateObject.mockReset();
  ai.generateObject.mockResolvedValue({ object: { region: "lumbar", level: "L4", pathology: "bulge" } });
});
afterEach(() => vi.unstubAllEnvs());

const configure = () => {
  vi.stubEnv("AI_BASE_URL", "https://ai.example.test/v1");
  vi.stubEnv("AI_API_KEY", "key-123");
  vi.stubEnv("AI_MODEL", "vendor/some-model");
};

describe("report extraction", () => {
  it("uses AI_MODEL through the shared client and returns the validated diagnosis", async () => {
    configure();
    await expect(extractClinicalDiagnosis("  MRI: L4-L5 disc bulge.  ")).resolves.toEqual({ region: "lumbar", level: "L4", pathology: "bulge" });

    const call = ai.generateObject.mock.calls[0][0];
    expect((call.model as { modelId: string }).modelId).toBe("vendor/some-model");
    expect(call.prompt).toBe("MRI: L4-L5 disc bulge.");
    expect(call.system).toMatch(/structured clinical data extraction/);
    // the schema accepts the three fixed fields and rejects anything else
    expect(call.schema.safeParse({ region: "lumbar", level: "L4", pathology: "bulge" }).success).toBe(true);
    expect(call.schema.safeParse({ region: "lumbar", level: "L4", pathology: "bulge", extra: 1 }).success).toBe(false);
    expect(call.schema.safeParse({ region: "lumbar", level: "L9", pathology: "bulge" }).success).toBe(false);
  });

  it("throws, without calling the model, when the AI settings are missing", async () => {
    vi.stubEnv("AI_BASE_URL", "");
    vi.stubEnv("AI_API_KEY", "key-123");
    vi.stubEnv("AI_MODEL", "");
    await expect(extractClinicalDiagnosis("MRI: L4-L5 disc bulge.")).rejects.toThrow(AiConfigError);
    await expect(extractClinicalDiagnosis("MRI: L4-L5 disc bulge.")).rejects.toThrow(/AI_BASE_URL, AI_MODEL/);
    expect(ai.generateObject).not.toHaveBeenCalled();
  });

  it("refuses an empty report before anything else", async () => {
    await expect(extractClinicalDiagnosis("   ")).rejects.toThrow("Report text is required");
    expect(ai.generateObject).not.toHaveBeenCalled();
  });
});
