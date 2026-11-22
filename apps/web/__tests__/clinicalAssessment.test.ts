import { describe, expect, it } from "vitest";
import {
  CONDITION_SOURCE_LABELS,
  deriveConditionSource,
  evaluateProgressEscalation,
  screenQuizAnswers,
  screenRedFlags,
} from "@/lib/clinical/assessment";

const files = (scans: number, prescriptions: number, uncategorized = 0) => ({
  scans: Array.from({ length: scans }, (_, i) => `s${i}`),
  prescriptions: Array.from({ length: prescriptions }, (_, i) => `p${i}`),
  uncategorized: Array.from({ length: uncategorized }, (_, i) => `u${i}`),
});

describe("condition source attribution", () => {
  it("labels exactly what the conclusion was derived from", () => {
    expect(CONDITION_SOURCE_LABELS[deriveConditionSource(files(1, 1))]).toBe(
      "Derived from medical reports & scans",
    );
    expect(CONDITION_SOURCE_LABELS[deriveConditionSource(files(0, 2))]).toBe(
      "Derived from medical reports & symptoms",
    );
    expect(CONDITION_SOURCE_LABELS[deriveConditionSource(files(3, 0))]).toBe(
      "Derived from imaging scans & symptoms only",
    );
    expect(CONDITION_SOURCE_LABELS[deriveConditionSource(files(0, 0))]).toBe(
      "Derived from symptom description only",
    );
    expect(deriveConditionSource(files(0, 0, 2))).toBe("files_and_symptoms");
  });
});

describe("red-flag screen", () => {
  it("finds high-risk warning signs", () => {
    expect(screenRedFlags("Since yesterday I have lost bladder control and my back hurts")).toContain(
      "Loss of bladder or bowel control",
    );
    expect(screenRedFlags("numbness around my groin")).toContain("Numbness in the groin or saddle area");
    expect(screenRedFlags("I can't bear weight on my ankle after the fall")).toContain("Possible fracture");
    expect(screenRedFlags("My left leg is getting weaker every day")).toContain(
      "Progressive weakness or foot drop",
    );
    expect(screenRedFlags("Heard a pop and my Achilles tendon is torn")).toContain(
      "Possible tendon or ligament rupture",
    );
  });

  it("ignores negated mentions and ordinary symptoms", () => {
    expect(screenRedFlags("No fever, no loss of bladder control, no numbness in the groin.")).toEqual([]);
    expect(screenRedFlags("Pain and stiffness around the right knee after long walks.")).toEqual([]);
    expect(screenRedFlags("Lower back pain when sitting at my desk")).toEqual([]);
  });

  it("flags yes answers to red-flag questions only", () => {
    expect(
      screenQuizAnswers([
        { question: "Have you noticed any loss of bladder or bowel control?", answer: "Yes" },
      ]),
    ).toEqual(["Loss of bladder or bowel control"]);
    expect(
      screenQuizAnswers([
        { question: "Have you noticed any loss of bladder or bowel control?", answer: "No" },
        { question: "Do you have a fever?", answer: "Not sure" },
        { question: "Are you able to bear weight on the leg?", answer: "Yes" },
      ]),
    ).toEqual([]);
    expect(
      screenQuizAnswers([{ question: "Anything else?", answer: "I get chest pain when I walk" }]),
    ).toEqual(["Chest pain or trouble breathing"]);
  });
});

describe("progress escalation", () => {
  const today = "2026-11-20";

  it("does not escalate a case that is improving", () => {
    expect(
      evaluateProgressEscalation(
        [
          { dateKey: "2026-11-17", feedback: "issue" },
          { dateKey: "2026-11-18", feedback: "same" },
          { dateKey: "2026-11-19", feedback: "relief" },
        ],
        [],
        today,
      ),
    ).toBeNull();
  });

  it("escalates after Pain Override on two separate days within 14 days", () => {
    const result = evaluateProgressEscalation(
      [],
      [
        { dateKey: "2026-11-10", painType: "sharp_pain" },
        { dateKey: "2026-11-19", painType: "movement_loss" },
      ],
      today,
    );
    expect(result?.kind).toBe("progress");
    expect(result?.evidence.join(" ")).toMatch(/2 separate days/);
    expect(result?.evidence.join(" ")).toMatch(/loss of movement/);
  });

  it("does not count two stops on the same day or outside the window", () => {
    expect(
      evaluateProgressEscalation(
        [],
        [
          { dateKey: "2026-11-19", painType: "sharp_pain" },
          { dateKey: "2026-11-19", painType: "other" },
          { dateKey: "2026-10-20", painType: "sharp_pain" },
        ],
        today,
      ),
    ).toBeNull();
  });

  it("escalates when the last three sessions were all negative", () => {
    const result = evaluateProgressEscalation(
      [
        { dateKey: "2026-11-15", feedback: "relief" },
        { dateKey: "2026-11-17", feedback: "issue" },
        { dateKey: "2026-11-19", feedback: "issue" },
      ],
      [{ dateKey: "2026-11-18", painType: "sharp_pain" }],
      today,
    );
    expect(result?.evidence.join(" ")).toMatch(/last 3 sessions/);
  });

  it("escalates a plateau: five sessions, no relief, two problems", () => {
    const result = evaluateProgressEscalation(
      [
        { dateKey: "2026-11-14", feedback: "issue" },
        { dateKey: "2026-11-15", feedback: "same" },
        { dateKey: "2026-11-16", feedback: "same" },
        { dateKey: "2026-11-17", feedback: "issue" },
        { dateKey: "2026-11-18", feedback: "same" },
      ],
      [],
      today,
    );
    expect(result?.evidence.join(" ")).toMatch(/None of your last 5 sessions brought relief/);
  });
});
