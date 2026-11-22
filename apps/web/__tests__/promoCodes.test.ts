import { describe, expect, it } from "vitest";
import { findPromoCode, normalizePromoInput, parsePromoCodes, PROMO_DURATION_DAYS } from "@/lib/billing/promoCodes";

describe("parsePromoCodes", () => {
  it("reads comma-separated codes, trimmed and upper-cased", () => {
    expect(parsePromoCodes(" somacue2m , Interview2026 ")).toEqual([
      { code: "SOMACUE2M", maxUses: null },
      { code: "INTERVIEW2026", maxUses: null },
    ]);
  });

  it("reads an optional :MAX_USES suffix", () => {
    expect(parsePromoCodes("INTERVIEW2026:25, OPEN2M")).toEqual([
      { code: "INTERVIEW2026", maxUses: 25 },
      { code: "OPEN2M", maxUses: null },
    ]);
    expect(parsePromoCodes("spaced : 7")).toEqual([{ code: "SPACED", maxUses: 7 }]);
  });

  it("drops a bad cap instead of making the code unlimited", () => {
    expect(parsePromoCodes("A1B2C3:0, A1B2C4:abc, A1B2C5:-3, A1B2C6:1.5, A1B2C7:, A1B2C8:2:3")).toEqual([]);
  });

  it("drops entries that are empty, too short, too long or use other characters", () => {
    const tooLong = "A".repeat(41);
    expect(parsePromoCodes(`,, AB, ${tooLong}, HAS SPACE, BAD!CODE, -LEAD, GOOD-code_1`)).toEqual([
      { code: "GOOD-CODE_1", maxUses: null },
    ]);
  });

  it("keeps the first entry of a repeated code", () => {
    expect(parsePromoCodes("REPEAT:5, repeat, REPEAT:9")).toEqual([{ code: "REPEAT", maxUses: 5 }]);
  });

  it("returns nothing when the variable is missing or empty", () => {
    expect(parsePromoCodes(undefined)).toEqual([]);
    expect(parsePromoCodes(null)).toEqual([]);
    expect(parsePromoCodes("")).toEqual([]);
  });
});

describe("findPromoCode", () => {
  const raw = "SOMACUE2M,INTERVIEW2026:25";

  it("matches whatever case and padding the user typed", () => {
    expect(findPromoCode("  somacue2m ", raw)).toEqual({ code: "SOMACUE2M", maxUses: null });
    expect(findPromoCode("Interview2026", raw)).toEqual({ code: "INTERVIEW2026", maxUses: 25 });
  });

  it("returns null for unknown, empty and non-string input", () => {
    expect(findPromoCode("NOPE", raw)).toBeNull();
    expect(findPromoCode("   ", raw)).toBeNull();
    expect(findPromoCode(undefined, raw)).toBeNull();
    expect(findPromoCode(42, raw)).toBeNull();
    expect(findPromoCode("SOMACUE2M", "")).toBeNull();
  });

  it("does not match a prefix or the :N suffix", () => {
    expect(findPromoCode("INTERVIEW", raw)).toBeNull();
    expect(findPromoCode("INTERVIEW2026:25", raw)).toBeNull();
  });
});

describe("promo basics", () => {
  it("normalizes input", () => {
    expect(normalizePromoInput("  abc  ")).toBe("ABC");
    expect(normalizePromoInput(null)).toBe("");
  });

  it("is worth 60 days", () => {
    expect(PROMO_DURATION_DAYS).toBe(60);
  });
});
