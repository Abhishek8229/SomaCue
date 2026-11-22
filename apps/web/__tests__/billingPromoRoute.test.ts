// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  redeem: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/billing/promo", () => ({ redeemPromoCode: mocks.redeem }));
vi.mock("@/lib/billing/entitlements", () => ({ getBillingStatus: mocks.status }));

import { POST } from "@/app/api/billing/promo/route";
import { clearPromoFailures, PROMO_MAX_FAILURES } from "@/lib/billing/promoThrottle";

const END = new Date("2027-01-24T10:00:00.000Z");
const PRO_STATUS = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: END.toISOString(),
  tier: "2m",
  usage: { analysesUsed: 0, companionMessagesUsed: 0 },
};

const send = (body: unknown, raw = false) =>
  POST(
    new Request("http://localhost/api/billing/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv("PROMO_CODES", "SOMACUE2M,INTERVIEW2026:25");
  mocks.user = { id: "user-1" };
  mocks.redeem.mockReset();
  mocks.redeem.mockResolvedValue({ ok: true, accessStart: new Date(), accessEnd: END, durationDays: 60 });
  mocks.status.mockReset();
  mocks.status.mockResolvedValue(PRO_STATUS);
  clearPromoFailures("user-1");
  clearPromoFailures("user-2");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/billing/promo", () => {
  it("returns 401 when signed out, without touching the database", async () => {
    mocks.user = null;
    const response = await send({ code: "SOMACUE2M" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "UNAUTHENTICATED" });
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("redeems a valid code and returns the new plan and expiry date", async () => {
    const response = await send({ code: "SOMACUE2M" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redeemed: true, durationDays: 60, expiresAt: END.toISOString(), billing: PRO_STATUS });
    expect(mocks.redeem).toHaveBeenCalledWith("user-1", { code: "SOMACUE2M", maxUses: null });
  });

  it("matches the code case-insensitively and trims it", async () => {
    const response = await send({ code: "  somacue2m \n" });
    expect(response.status).toBe(200);
    expect(mocks.redeem).toHaveBeenCalledWith("user-1", { code: "SOMACUE2M", maxUses: null });
  });

  it("passes the MAX_USES cap on", async () => {
    await send({ code: "interview2026" });
    expect(mocks.redeem).toHaveBeenCalledWith("user-1", { code: "INTERVIEW2026", maxUses: 25 });
  });

  it("rejects an unknown code with 400", async () => {
    const response = await send({ code: "NOPE" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_CODE", message: expect.stringContaining("isn't valid") });
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("rejects every code when PROMO_CODES is not set", async () => {
    vi.stubEnv("PROMO_CODES", "");
    expect((await send({ code: "SOMACUE2M" })).status).toBe(400);
  });

  it.each([
    ["an empty code", { code: "   " }],
    ["a missing code", {}],
    ["a non-string code", { code: 42 }],
    ["a code that is far too long", { code: "A".repeat(500) }],
  ])("rejects %s with 400", async (_name, body) => {
    const response = await send(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "EMPTY_CODE" });
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON with 400", async () => {
    expect((await send("not json", true)).status).toBe(400);
  });

  it.each([
    ["already_pro", "ALREADY_PRO", "active Pro plan"],
    ["already_redeemed", "ALREADY_REDEEMED", "already used"],
    ["exhausted", "CODE_EXHAUSTED", "reached its limit"],
  ])("answers %s with 409", async (reason, error, text) => {
    mocks.redeem.mockResolvedValue({ ok: false, reason, currentPeriodEnd: null });
    const response = await send({ code: "SOMACUE2M" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error, message: expect.stringContaining(text) });
  });

  it("returns a clean 500 when the database fails", async () => {
    mocks.redeem.mockRejectedValue(new Error("connection lost to postgres://secret"));
    const response = await send({ code: "SOMACUE2M" });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("postgres://");
  });

  describe("guessing", () => {
    it("blocks a user after repeated wrong codes, with Retry-After", async () => {
      for (let attempt = 0; attempt < PROMO_MAX_FAILURES; attempt += 1) {
        expect((await send({ code: `WRONG${attempt}` })).status).toBe(400);
      }
      const blocked = await send({ code: "SOMACUE2M" });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(mocks.redeem).not.toHaveBeenCalled();
    });

    it("does not block other users", async () => {
      for (let attempt = 0; attempt < PROMO_MAX_FAILURES; attempt += 1) await send({ code: `WRONG${attempt}` });
      mocks.user = { id: "user-2" };
      expect((await send({ code: "SOMACUE2M" })).status).toBe(200);
    });

    it("a success clears earlier wrong guesses", async () => {
      for (let attempt = 0; attempt < PROMO_MAX_FAILURES - 1; attempt += 1) await send({ code: `WRONG${attempt}` });
      expect((await send({ code: "SOMACUE2M" })).status).toBe(200);
      expect((await send({ code: "WRONG-AGAIN" })).status).toBe(400);
    });
  });
});
