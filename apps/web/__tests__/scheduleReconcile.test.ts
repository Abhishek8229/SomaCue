// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StoredTreatmentPlan } from "@/lib/progress/dailyProgress";
import {
  MAX_REPLAYED_SESSIONS,
  activeSkipNotice,
  baseScheduleDays,
  daysBetween,
  describeSkipNotice,
  isoToDateKey,
  reconcileSchedule,
  shiftDateKey,
} from "@/lib/progress/schedule";

const step = (exerciseName: string) => ({
  exerciseName,
  animationTriggerId: exerciseName.toLowerCase().replaceAll(" ", "_"),
  durationSeconds: 60,
  voiceCue: "Cue",
});

/** Focus names make each day easy to recognise: 0 Mobility, 1 to 2 Control, 3 rest, 4 to 5 Strength, 6 rest. */
const PLAN: StoredTreatmentPlan = {
  durationMonths: 2,
  phases: [
    { phase: "Calm", tagline: "Gentle." },
    { phase: "Build", tagline: "Steady." },
  ],
  steps: [step("Supine Pelvic Tilt"), step("Glute Bridge"), step("Bird Dog")],
  schedule: {
    horizonDays: 7,
    days: [
      { dayOffset: 0, status: "active", focus: "Mobility", tagline: "a" },
      { dayOffset: 1, status: "upcoming", focus: "Control A", tagline: "b" },
      { dayOffset: 2, status: "upcoming", focus: "Control B", tagline: "c" },
      { dayOffset: 3, status: "rest", focus: "Recovery", tagline: "d" },
      { dayOffset: 4, status: "upcoming", focus: "Strength A", tagline: "e" },
      { dayOffset: 5, status: "upcoming", focus: "Strength B", tagline: "f" },
      { dayOffset: 6, status: "rest", focus: "Recovery", tagline: "g" },
    ],
  },
};

const DAY_1 = "2026-11-17";
const done = (dateKey: string) => ({ dateKey, completedExercises: ["Supine Pelvic Tilt"], completed: false });
const focusOf = (plan: StoredTreatmentPlan) => plan.schedule?.days.map((day) => day.focus);

describe("date helpers", () => {
  it("shifts and counts calendar days across a month end", () => {
    expect(shiftDateKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(daysBetween("2026-11-17", "2026-11-18")).toBe(1);
  });

  it("finds the viewer's own calendar day from a UTC time", () => {
    // 14:37 UTC on 17 Nov is 20:07 in India (offset -330) and 09:37 in New York (offset 300).
    expect(isoToDateKey("2026-11-17T14:37:46.399Z", -330)).toBe("2026-11-17");
    expect(isoToDateKey("2026-11-17T20:30:00.000Z", -330)).toBe("2026-11-18");
    expect(isoToDateKey("2026-11-18T02:00:00.000Z", 300)).toBe("2026-11-17");
  });
});

describe("the analysis day is Day 1", () => {
  it("dates an undated plan on its first sync and leaves it alone afterwards", () => {
    const first = reconcileSchedule(PLAN, [], DAY_1, DAY_1);
    expect(first.changed).toBe(true);
    expect(first.plan).toMatchObject({ startDateKey: DAY_1, scheduleAnchor: DAY_1 });
    expect(first.skippedDateKeys).toEqual([]);
    expect(focusOf(first.plan)).toEqual(focusOf(PLAN));

    const again = reconcileSchedule(first.plan, [], DAY_1, DAY_1);
    expect(again.changed).toBe(false);
    expect(again.plan).toBe(first.plan);
  });

  it("does nothing if the device clock is set back", () => {
    const dated = reconcileSchedule(PLAN, [], DAY_1, DAY_1).plan;
    const earlier = reconcileSchedule(dated, [], "2026-11-16", DAY_1);
    expect(earlier.changed).toBe(false);
    expect(earlier.skippedDateKeys).toEqual([]);
  });
});

describe("a skipped day", () => {
  const dated = reconcileSchedule(PLAN, [], DAY_1, DAY_1).plan;

  it("moves the plan forward so today repeats the missed session", () => {
    const result = reconcileSchedule(dated, [], "2026-11-18", DAY_1);

    expect(result.changed).toBe(true);
    expect(result.skippedDateKeys).toEqual([DAY_1]);
    expect(result.shiftedDays).toBe(1);
    expect(result.plan.scheduleAnchor).toBe("2026-11-18");
    expect(result.plan.startDateKey).toBe(DAY_1);
    // Today is the session that was missed; the rest of the week follows in order.
    expect(focusOf(result.plan)).toEqual([
      "Mobility",
      "Control A",
      "Control B",
      "Recovery",
      "Strength A",
      "Strength B",
      "Recovery",
    ]);
    expect(result.plan.schedule?.days[0]).toMatchObject({ dayOffset: 0, status: "active" });
    expect(result.plan.schedule?.days[1].status).toBe("upcoming");
  });

  it("records the skip and an alert that stays until it is dismissed", () => {
    const result = reconcileSchedule(dated, [], "2026-11-18", DAY_1);
    expect(result.plan.skippedDays).toEqual([DAY_1]);
    expect(activeSkipNotice(result.plan)).toEqual({
      dateKeys: [DAY_1],
      shiftedDays: 1,
      noticedOn: "2026-11-18",
      dismissed: false,
    });

    const dismissed = { ...result.plan, skipNotice: { ...result.plan.skipNotice!, dismissed: true } };
    expect(activeSkipNotice(dismissed)).toBeNull();
    // Opening the app again the same day changes nothing and does not bring the alert back.
    const later = reconcileSchedule(dismissed, [], "2026-11-18", DAY_1);
    expect(later.changed).toBe(false);
    expect(activeSkipNotice(later.plan)).toBeNull();
  });

  it("does not repeat a session that was done", () => {
    const result = reconcileSchedule(dated, [done(DAY_1)], "2026-11-18", DAY_1);
    expect(result.skippedDateKeys).toEqual([]);
    expect(result.shiftedDays).toBe(0);
    expect(result.plan.skipNotice ?? null).toBeNull();
    // Yesterday was Mobility, so today is the next day of the plan.
    expect(focusOf(result.plan)?.[0]).toBe("Control A");
  });

  it("counts a single ticked exercise, a finished day or a Pain Override stop as attempted", () => {
    for (const row of [
      done(DAY_1),
      { dateKey: DAY_1, completedExercises: [], completed: true },
      { dateKey: DAY_1, completedExercises: [], completed: false, stopped: true },
    ]) {
      expect(reconcileSchedule(dated, [row], "2026-11-18", DAY_1).skippedDateKeys).toEqual([]);
    }
  });

  it("does not call a rest day skipped", () => {
    // Anchored on the 14th, offsets 0 to 2 were worked, so the 17th (offset 3) was the rest day.
    const worked = ["2026-11-14", "2026-11-15", "2026-11-16"].map(done);
    const result = reconcileSchedule(
      reconcileSchedule(PLAN, [], "2026-11-14", "2026-11-14").plan,
      worked,
      "2026-11-18",
      "2026-11-14",
    );
    expect(result.skippedDateKeys).toEqual([]);
    // Day offset 4 is today.
    expect(focusOf(result.plan)?.[0]).toBe("Strength A");
  });

  it("replays several missed sessions in order, up to the limit", () => {
    const anchor = reconcileSchedule(PLAN, [], "2026-11-10", "2026-11-10").plan;

    const threeMissed = reconcileSchedule(anchor, [], "2026-11-13", "2026-11-10");
    expect(threeMissed.skippedDateKeys).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(threeMissed.shiftedDays).toBe(3);
    expect(focusOf(threeMissed.plan)?.slice(0, 4)).toEqual(["Mobility", "Control A", "Control B", "Recovery"]);

    // Five working days missed: all are recorded, only three are replayed.
    const manyMissed = reconcileSchedule(anchor, [], "2026-11-15", "2026-11-10");
    expect(manyMissed.skippedDateKeys).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-14"]);
    expect(manyMissed.shiftedDays).toBe(MAX_REPLAYED_SESSIONS);
    expect(focusOf(manyMissed.plan)?.slice(0, 3)).toEqual(["Mobility", "Control A", "Control B"]);
    expect(manyMissed.plan.skippedDays).toHaveLength(4);
  });

  it("carries on with the weekly pattern after the stored days run out", () => {
    const result = reconcileSchedule(dated, [], "2026-11-26", DAY_1);
    // Nine days passed: the stored week repeats, so the plan never has a gap.
    expect(result.plan.schedule?.days).toHaveLength(7);
    expect(result.plan.schedule?.days.every((day) => day.focus.length > 0)).toBe(true);
    expect(result.skippedDateKeys.length).toBeGreaterThan(0);
  });

  it("clears old reschedule backups, which pointed at the previous days", () => {
    const withBackup = { ...dated, rescheduleBackups: { "2026-11-17": [] } };
    const result = reconcileSchedule(withBackup, [], "2026-11-18", DAY_1);
    expect(result.plan.rescheduleBackups).toBeUndefined();
  });

  it("keeps each day's own exercises when moving it", () => {
    const withSteps: StoredTreatmentPlan = {
      ...dated,
      schedule: {
        horizonDays: 7,
        days: dated.schedule!.days.map((day) =>
          day.status === "rest" ? day : { ...day, steps: [step(`Move ${day.dayOffset}`)] },
        ),
      },
    };
    const result = reconcileSchedule(withSteps, [], "2026-11-18", DAY_1);
    expect(result.plan.schedule?.days[0].steps?.[0].exerciseName).toBe("Move 0");
    expect(result.plan.schedule?.days[1].steps?.[0].exerciseName).toBe("Move 1");
  });
});

describe("older plans", () => {
  it("falls back to five working days then two rest days when there is no stored schedule", () => {
    const bare: StoredTreatmentPlan = { ...PLAN, schedule: undefined };
    const days = baseScheduleDays(bare);
    expect(days.map((day) => day.status)).toEqual(["active", "upcoming", "upcoming", "upcoming", "upcoming", "rest", "rest"]);

    const result = reconcileSchedule(bare, [], "2026-11-18", DAY_1);
    expect(result.skippedDateKeys).toEqual([DAY_1]);
    expect(result.plan.schedule?.days).toHaveLength(7);
  });
});

describe("describeSkipNotice", () => {
  it("names one skipped day", () => {
    expect(describeSkipNotice({ dateKeys: [DAY_1], shiftedDays: 1, noticedOn: "2026-11-18", dismissed: false })).toEqual({
      title: "You skipped Nov 17",
      body: "No exercises were logged. Your plan moved forward one day, so today repeats the session you missed.",
    });
  });

  it("lists several skipped days", () => {
    const text = describeSkipNotice({
      dateKeys: ["2026-11-10", "2026-11-11", "2026-11-12"],
      shiftedDays: 3,
      noticedOn: "2026-11-13",
      dismissed: false,
    });
    expect(text.title).toBe("You skipped 3 days: Nov 10, Nov 11 and Nov 12");
    expect(text.body).toContain("moved forward 3 days");
  });
});
