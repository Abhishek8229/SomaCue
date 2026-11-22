// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The helper takes the client as an argument; this only stops the real one from needing DATABASE_URL on import.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { PRO_DAY_MS, resolvePlan } from "@/lib/billing/plans";
import { redeemPromoCode } from "@/lib/billing/promo";
import { PROMO_DURATION_DAYS } from "@/lib/billing/promoCodes";

/*
 * An in-memory database with Serializable-style behaviour: a transaction works on a copy and commits only if nobody
 * else committed since it started. Otherwise it fails with P2034 (a write conflict), exactly what Postgres reports.
 */
type SubRow = {
  userId: string;
  provider: string;
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  tier: string | null;
  providerSubscriptionId?: string | null;
};
type RedemptionRow = { userId: string; code: string; durationDays: number; redeemedAt: Date };
type State = { subs: SubRow[]; redemptions: RedemptionRow[] };

function fakeDb(initial: Partial<State> = {}) {
  const state: State & { version: number; isolation: Array<string | null>; attempts: number } = {
    subs: initial.subs ?? [],
    redemptions: initial.redemptions ?? [],
    version: 0,
    isolation: [],
    attempts: 0,
  };

  const client = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>, options?: { isolationLevel?: string }) => {
      state.attempts += 1;
      state.isolation.push(options?.isolationLevel ?? null);
      const startVersion = state.version;
      const draft: State = { subs: state.subs.map((row) => ({ ...row })), redemptions: state.redemptions.map((row) => ({ ...row })) };
      let wrote = false;

      const tx = {
        subscription: {
          findUnique: async ({ where }: { where: { userId: string } }) => {
            await Promise.resolve();
            return draft.subs.find((row) => row.userId === where.userId) ?? null;
          },
          upsert: async ({ where, create, update }: { where: { userId: string }; create: SubRow; update: Partial<SubRow> }) => {
            wrote = true;
            const row = draft.subs.find((item) => item.userId === where.userId);
            if (row) Object.assign(row, update);
            else draft.subs.push({ ...create });
          },
        },
        promoRedemption: {
          findUnique: async ({ where }: { where: { userId_code: { userId: string; code: string } } }) => {
            await Promise.resolve();
            return draft.redemptions.find((row) => row.userId === where.userId_code.userId && row.code === where.userId_code.code) ?? null;
          },
          count: async ({ where }: { where: { code: string } }) => {
            await Promise.resolve();
            return draft.redemptions.filter((row) => row.code === where.code).length;
          },
          create: async ({ data }: { data: RedemptionRow }) => {
            wrote = true;
            if (draft.redemptions.some((row) => row.userId === data.userId && row.code === data.code)) {
              throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
            }
            draft.redemptions.push({ ...data });
          },
        },
      };

      const result = await work(tx);
      if (wrote) {
        if (state.version !== startVersion) throw Object.assign(new Error("Transaction failed due to a write conflict"), { code: "P2034" });
        state.subs = draft.subs;
        state.redemptions = draft.redemptions;
        state.version += 1;
      }
      return result;
    },
  };
  return { state, client: client as never };
}

const NOW = new Date("2026-11-25T10:00:00.000Z");
const OPEN = { code: "SOMACUE2M", maxUses: null };

const activePro = (overrides: Partial<SubRow> = {}): SubRow => ({
  userId: "u1",
  provider: "razorpay",
  plan: "pro",
  status: "active",
  currentPeriodEnd: new Date(NOW.getTime() + 10 * PRO_DAY_MS),
  cancelAtPeriodEnd: false,
  tier: "1m",
  providerSubscriptionId: "sub_1",
  ...overrides,
});

describe("redeemPromoCode", () => {
  it("grants 60 days of Pro and makes every Pro check pass", async () => {
    const { state, client } = fakeDb();
    const result = await redeemPromoCode("u1", OPEN, NOW, client);

    const end = new Date(NOW.getTime() + 60 * PRO_DAY_MS);
    expect(result).toEqual({ ok: true, accessStart: NOW, accessEnd: end, durationDays: 60 });
    expect(PROMO_DURATION_DAYS).toBe(60);
    expect(state.subs).toEqual([
      { userId: "u1", provider: "promo", plan: "pro", status: "active", currentPeriodEnd: end, cancelAtPeriodEnd: false, tier: "2m" },
    ]);
    expect(state.redemptions).toEqual([{ userId: "u1", code: "SOMACUE2M", durationDays: 60, redeemedAt: NOW }]);
    expect(resolvePlan(state.subs[0], NOW)).toBe("pro");
    expect(resolvePlan(state.subs[0], new Date(end.getTime() + 1))).toBe("free");
  });

  it("runs in a Serializable transaction", async () => {
    const { state, client } = fakeDb();
    await redeemPromoCode("u1", OPEN, NOW, client);
    expect(state.isolation).toEqual(["Serializable"]);
  });

  it("refuses a second use of the same code by the same user", async () => {
    const { state, client } = fakeDb();
    await redeemPromoCode("u1", OPEN, NOW, client);
    // The first grant has run out by the time of the second try, so only the used-code rule applies.
    const later = new Date(NOW.getTime() + 61 * PRO_DAY_MS);
    expect(await redeemPromoCode("u1", OPEN, later, client)).toEqual({ ok: false, reason: "already_redeemed" });
    expect(state.redemptions).toHaveLength(1);
  });

  it("lets the same user use a different code after the first has ended", async () => {
    const { state, client } = fakeDb();
    await redeemPromoCode("u1", OPEN, NOW, client);
    const later = new Date(NOW.getTime() + 61 * PRO_DAY_MS);
    const second = await redeemPromoCode("u1", { code: "OTHER2M", maxUses: null }, later, client);
    expect(second.ok).toBe(true);
    expect(state.redemptions).toHaveLength(2);
  });

  it("blocks while a Pro plan is active and writes nothing", async () => {
    const pro = activePro();
    const { state, client } = fakeDb({ subs: [pro] });
    const result = await redeemPromoCode("u1", OPEN, NOW, client);

    expect(result).toEqual({ ok: false, reason: "already_pro", currentPeriodEnd: pro.currentPeriodEnd });
    expect(state.redemptions).toEqual([]);
    expect(state.subs).toEqual([pro]);
    expect(state.version).toBe(0);
  });

  it("blocks while a promo plan is still active", async () => {
    const { client } = fakeDb();
    await redeemPromoCode("u1", OPEN, NOW, client);
    const result = await redeemPromoCode("u1", { code: "OTHER2M", maxUses: null }, new Date(NOW.getTime() + DAYS(5)), client);
    expect(result).toMatchObject({ ok: false, reason: "already_pro" });
  });

  it("allows a user whose Pro has expired, and replaces the old subscription fields", async () => {
    const expired = activePro({ currentPeriodEnd: new Date(NOW.getTime() - PRO_DAY_MS), status: "expired" });
    const { state, client } = fakeDb({ subs: [expired] });
    const result = await redeemPromoCode("u1", OPEN, NOW, client);

    expect(result.ok).toBe(true);
    expect(state.subs).toHaveLength(1);
    expect(state.subs[0]).toMatchObject({
      provider: "promo",
      plan: "pro",
      status: "active",
      tier: "2m",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(NOW.getTime() + 60 * PRO_DAY_MS),
      providerSubscriptionId: "sub_1",
    });
  });

  it("allows a free-plan row", async () => {
    const free = activePro({ plan: "free", status: "none", currentPeriodEnd: null, tier: null });
    const { state, client } = fakeDb({ subs: [free] });
    expect((await redeemPromoCode("u1", OPEN, NOW, client)).ok).toBe(true);
    expect(state.subs[0].plan).toBe("pro");
  });

  describe("MAX_USES", () => {
    const capped = { code: "INTERVIEW2026", maxUses: 25 };

    it("lets 25 different users in and turns the 26th away", async () => {
      const { state, client } = fakeDb();
      for (let index = 1; index <= 25; index += 1) {
        expect((await redeemPromoCode(`user-${index}`, capped, NOW, client)).ok).toBe(true);
      }
      expect(await redeemPromoCode("user-26", capped, NOW, client)).toEqual({ ok: false, reason: "exhausted" });
      expect(state.redemptions.filter((row) => row.code === "INTERVIEW2026")).toHaveLength(25);
      expect(state.subs.find((row) => row.userId === "user-26")).toBeUndefined();
    });

    it("counts each code on its own", async () => {
      const { client } = fakeDb();
      expect((await redeemPromoCode("a", { code: "ONE1", maxUses: 1 }, NOW, client)).ok).toBe(true);
      expect(await redeemPromoCode("b", { code: "ONE1", maxUses: 1 }, NOW, client)).toMatchObject({ reason: "exhausted" });
      expect((await redeemPromoCode("b", { code: "TWO2", maxUses: 1 }, NOW, client)).ok).toBe(true);
    });

    it("never gives the last use to two racing users", async () => {
      const { state, client } = fakeDb({
        redemptions: Array.from({ length: 24 }, (_, index) => ({ userId: `early-${index}`, code: "INTERVIEW2026", durationDays: 60, redeemedAt: NOW })),
      });
      const results = await Promise.all([redeemPromoCode("racer-1", capped, NOW, client), redeemPromoCode("racer-2", capped, NOW, client)]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "exhausted" }]);
      expect(state.redemptions).toHaveLength(25);
      expect(state.attempts).toBeGreaterThan(2); // the loser was rolled back and retried
    });

    it("never lets many racers pass the cap", async () => {
      const { state, client } = fakeDb();
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, index) => redeemPromoCode(`racer-${index}`, { code: "RACE", maxUses: 2 }, NOW, client)),
      );
      expect(results.filter((result) => result.ok).length).toBeLessThanOrEqual(2);
      expect(state.redemptions.filter((row) => row.code === "RACE").length).toBeLessThanOrEqual(2);
    });
  });

  describe("concurrency", () => {
    it("grants a user who double-clicks only once", async () => {
      const { state, client } = fakeDb();
      const results = await Promise.all([redeemPromoCode("u1", OPEN, NOW, client), redeemPromoCode("u1", OPEN, NOW, client)]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.find((result) => !result.ok)).toMatchObject({ ok: false });
      expect(state.redemptions).toHaveLength(1);
      expect(state.subs).toHaveLength(1);
    });

    it("maps a unique-key violation to already_redeemed", async () => {
      const client = {
        $transaction: async () => {
          throw Object.assign(new Error("Unique constraint failed on (userId, code)"), { code: "P2002" });
        },
      } as never;
      expect(await redeemPromoCode("u1", OPEN, NOW, client)).toEqual({ ok: false, reason: "already_redeemed" });
    });

    it("rethrows errors it does not know", async () => {
      const client = {
        $transaction: async () => {
          throw new Error("connection lost");
        },
      } as never;
      await expect(redeemPromoCode("u1", OPEN, NOW, client)).rejects.toThrow("connection lost");
    });
  });
});

function DAYS(count: number) {
  return count * PRO_DAY_MS;
}
