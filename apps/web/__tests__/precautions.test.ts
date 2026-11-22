// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  badgeFor,
  buildDynamicItems,
  createDynamicPrecautions,
  initialPrecautions,
  isUnread,
  normalizePrecautions,
  parseDynamicPrecautions,
  parsePermanentPrecautions,
  phaseIndexOf,
  precautionsAreStale,
  PRECAUTION_MAX,
  PRECAUTION_MIN,
  SAFE_DEFAULTS,
  weekOfPlan,
  type DynamicInput,
} from "@/lib/precautions/precautions";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const PHASE = { phase: "Calm", tagline: "Settle the irritated tissue" };
const input = (extra: Partial<DynamicInput> = {}): DynamicInput => ({
  kind: "week",
  weekNumber: 1,
  phase: PHASE,
  base: ["Keep your lower back flat on the floor during bridges."],
  feedback: [],
  painEvents: [],
  missedDays: 0,
  ...extra,
});

describe("normalizePrecautions", () => {
  it("trims, drops blanks and duplicates, and caps the list at 5", () => {
    const out = normalizePrecautions(["  a one ", "A ONE", "", "two", "- three", "four", "five", "six", "seven"]);
    expect(out).toEqual(["a one", "two", "three", "four", "five"]);
    expect(out).toHaveLength(PRECAUTION_MAX);
  });

  it("fills a short list from the safe defaults, up to 3", () => {
    const out = normalizePrecautions(["Avoid deep forward bends."]);
    expect(out).toHaveLength(PRECAUTION_MIN);
    expect(out[0]).toBe("Avoid deep forward bends.");
    expect(SAFE_DEFAULTS).toEqual(expect.arrayContaining(out.slice(1)));
  });

  it("copes with anything that is not a list of strings", () => {
    expect(normalizePrecautions(undefined)).toHaveLength(PRECAUTION_MIN);
    expect(normalizePrecautions([1, null, { a: 1 }, "ok"])[0]).toBe("ok");
  });

  it("shortens a very long bullet instead of storing an essay", () => {
    const [bullet] = normalizePrecautions(["word ".repeat(100)]);
    expect(bullet.length).toBeLessThanOrEqual(200);
    expect(bullet.endsWith("…")).toBe(true);
  });
});

describe("week and phase of a plan day", () => {
  it("counts Day 1 to 7 as week 1, Day 8 as week 2", () => {
    expect([1, 7, 8, 14, 15, 30, 31].map(weekOfPlan)).toEqual([1, 1, 2, 2, 3, 5, 5]);
    expect(weekOfPlan(0)).toBe(1);
  });

  it("moves to the next phase every 30 days and never past the last one", () => {
    expect([1, 30, 31, 60, 61, 200].map((day) => phaseIndexOf(day, 3))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(phaseIndexOf(45, 1)).toBe(0);
  });

  it("knows when the stored week or phase is out of date", () => {
    const stored = { weekNumber: 1, phaseIndex: 0 };
    expect(precautionsAreStale(stored, 7, 2)).toBe(false);
    expect(precautionsAreStale(stored, 8, 2)).toBe(true);
    expect(precautionsAreStale({ weekNumber: 5, phaseIndex: 0 }, 31, 2)).toBe(true);
    expect(precautionsAreStale({ weekNumber: 5, phaseIndex: 1 }, 31, 2)).toBe(false);
  });
});

describe("badges and the unread dot", () => {
  it("names the week for a new plan or week, and the cause for a change", () => {
    expect(badgeFor("initial", 1)).toBe("Week 1 • Active");
    expect(badgeFor("week", 3)).toBe("Week 3 • Active");
    expect(badgeFor("feedback", 2)).toBe("Updated after feedback");
    expect(badgeFor("pain_override", 2)).toBe("Updated after Pain Override");
    expect(badgeFor("missed_day", 2)).toBe("Updated after a missed day");
  });

  it("is unread until seen after the latest update", () => {
    const at = (iso: string) => new Date(iso).toISOString();
    expect(isUnread({ updatedAt: at("2026-11-19T10:00:00Z"), seenAt: null })).toBe(true);
    expect(isUnread({ updatedAt: at("2026-11-19T10:00:00Z"), seenAt: at("2026-11-19T10:00:00Z") })).toBe(false);
    expect(isUnread({ updatedAt: at("2026-11-19T11:00:00Z"), seenAt: at("2026-11-19T10:00:00Z") })).toBe(true);
  });
});

describe("buildDynamicItems", () => {
  it("gives 3 to 5 bullets in every situation", () => {
    const situations: DynamicInput[] = [
      input(),
      input({ phase: null, base: [] }),
      input({ feedback: [{ dateKey: "2026-11-19", feedback: "issue", discomfortExercises: ["Glute Bridge"] }] }),
      input({
        kind: "pain_override",
        painEvents: [{ dateKey: "2026-11-19", exerciseNames: ["Glute Bridge"], regions: ["lumbar"], painType: "sharp_pain" }],
        feedback: [{ dateKey: "2026-11-19", feedback: "issue", discomfortExercises: ["Ankle Pumps"] }],
        missedDays: 2,
        base: ["a", "b", "c", "d", "e"],
      }),
    ];
    for (const situation of situations) {
      const items = buildDynamicItems(situation);
      expect(items.length).toBeGreaterThanOrEqual(PRECAUTION_MIN);
      expect(items.length).toBeLessThanOrEqual(PRECAUTION_MAX);
      expect(new Set(items).size).toBe(items.length);
    }
  });

  it("puts the phase and week first when nothing has happened, then the AI's own week-1 bullets", () => {
    const items = buildDynamicItems(input({ weekNumber: 2 }));
    expect(items[0]).toBe("Calm (week 2): Settle the irritated tissue. Move on only when the last session felt comfortable.");
    expect(items).toContain("Keep your lower back flat on the floor during bridges.");
  });

  it("leads with a Pain Override: what to avoid, where, and when to stop", () => {
    const items = buildDynamicItems(
      input({ painEvents: [{ dateKey: "2026-11-19", exerciseNames: ["Glute Bridge", "Cat Cow"], regions: ["lumbar", "hip_left"], painType: "sharp_pain" }] }),
    );
    expect(items[0]).toBe("Pain Override on 2026-11-19: avoid Glute Bridge and Cat Cow until it has settled, and keep clear of the lumbar and hip left.");
    expect(items[1]).toMatch(/If the pain in the lumbar and hip left comes back, stop straight away and rest/);
  });

  it("reacts to the latest feedback: more discomfort, no change, or relief", () => {
    const withFeedback = (feedback: "relief" | "same" | "issue") =>
      buildDynamicItems(input({ feedback: [{ dateKey: "2026-11-19", feedback, discomfortExercises: ["Cat Cow"] }] }))[0];
    expect(withFeedback("issue")).toBe("More discomfort with Cat Cow: use a smaller range, go slower, and stop if it returns.");
    expect(withFeedback("same")).toBe("Little change so far: keep today's range and add no extra reps or speed.");
    expect(withFeedback("relief")).toMatch(/feeling better: add reps or range in small steps/);
  });

  it("only uses the newest feedback", () => {
    const items = buildDynamicItems(
      input({
        feedback: [
          { dateKey: "2026-11-19", feedback: "relief", discomfortExercises: [] },
          { dateKey: "2026-11-18", feedback: "issue", discomfortExercises: ["Cat Cow"] },
        ],
      }),
    );
    expect(items.join(" ")).not.toMatch(/More discomfort/);
  });

  it("says what to do after missed days, singular and plural", () => {
    expect(buildDynamicItems(input({ missedDays: 1 }))).toContain("You missed 1 day: restart at the planned pace, not harder, to catch up.");
    expect(buildDynamicItems(input({ missedDays: 3 }))).toContain("You missed 3 days: restart at the planned pace, not harder, to catch up.");
  });
});

describe("dynamic records", () => {
  it("marks a change unread, and the first set of a plan as already seen", () => {
    const changed = createDynamicPrecautions({ ...input({ kind: "feedback" }), phaseIndex: 0, now: NOW });
    expect(changed).toMatchObject({ kind: "feedback", badge: "Updated after feedback", updatedAt: NOW.toISOString(), seenAt: null, weekNumber: 1, phaseIndex: 0 });
    expect(isUnread(changed)).toBe(true);

    const first = createDynamicPrecautions({ ...input({ kind: "initial" }), phaseIndex: 0, now: NOW });
    expect(first.seenAt).toBe(NOW.toISOString());
    expect(isUnread(first)).toBe(false);
  });

  it("keeps the AI's bullets as the base for later rebuilds", () => {
    const record = createDynamicPrecautions({ ...input(), base: ["x", "y", "z"], phaseIndex: 0, now: NOW });
    expect(record.base).toEqual(["x", "y", "z"]);
  });

  it("builds the starting precautions from the AI's two lists", () => {
    const start = initialPrecautions({ permanentPrecautions: ["Avoid loaded flexion.", "Keep a neutral spine.", "Stop for leg numbness."], dynamicPrecautions: ["Start with small ranges.", "Pause if pain spreads."] }, NOW);
    expect(start.permanent).toEqual(["Avoid loaded flexion.", "Keep a neutral spine.", "Stop for leg numbness."]);
    expect(start.dynamic).toMatchObject({ kind: "initial", badge: "Week 1 • Active", weekNumber: 1, phaseIndex: 0, seenAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(start.dynamic.items).toHaveLength(PRECAUTION_MIN);
    expect(start.dynamic.items.slice(0, 2)).toEqual(["Start with small ranges.", "Pause if pain spreads."]);
  });

  it("never stores fewer than 3 or more than 5 even if the AI does", () => {
    const start = initialPrecautions({ permanentPrecautions: ["only one"], dynamicPrecautions: Array.from({ length: 9 }, (_, i) => `bullet ${i}`) }, NOW);
    expect(start.permanent).toHaveLength(PRECAUTION_MIN);
    expect(start.dynamic.items).toHaveLength(PRECAUTION_MAX);
  });
});

describe("reading what was stored", () => {
  it("accepts a stored list and rejects anything that is not one", () => {
    expect(parsePermanentPrecautions(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(parsePermanentPrecautions(null)).toBeNull();
    expect(parsePermanentPrecautions([])).toBeNull();
    expect(parsePermanentPrecautions("nope")).toBeNull();
    expect(parsePermanentPrecautions([1, " ", "ok"])).toEqual(["ok"]);
  });

  it("round-trips a dynamic record and rejects a damaged one", () => {
    const record = createDynamicPrecautions({ ...input({ kind: "pain_override" }), phaseIndex: 0, now: NOW });
    expect(parseDynamicPrecautions(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(parseDynamicPrecautions(null)).toBeNull();
    expect(parseDynamicPrecautions({ ...record, kind: "other" })).toBeNull();
    expect(parseDynamicPrecautions({ ...record, items: [] })).toBeNull();
    expect(parseDynamicPrecautions({ ...record, weekNumber: "1" })).toBeNull();
  });
});
