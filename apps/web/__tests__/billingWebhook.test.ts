// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type SubRow = {
  id: string;
  userId: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  plan: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  tier: string | null;
};

type PurchaseRow = {
  id: string;
  userId: string;
  providerSubscriptionId: string;
  tier: string;
  days: number;
  status: string;
  providerPaymentId: string | null;
  paidAt: Date | null;
  accessStart: Date | null;
  accessEnd: Date | null;
};

const db = vi.hoisted(() => ({
  events: new Set<string>(),
  sub: null as unknown,
  purchases: [] as unknown[],
  failUpdate: false,
  /** bumped by every committed transaction, so a transaction can tell it lost a race */
  version: 0,
  /** transactions that were rolled back and run again */
  conflicts: 0,
  /** how many times in a row the next Serializable transactions must lose, to test giving up */
  forceConflicts: 0,
  /** a pause inside a transaction, after it has read, so two of them really overlap */
  pause: false,
}));

const sub = () => db.sub as SubRow | null;
const purchases = () => db.purchases as PurchaseRow[];

type State = { events: Set<string>; sub: unknown; purchases: unknown[] };

vi.mock("@/lib/db/prisma", () => {
  // `state` is the committed data for plain calls, or a private copy inside a transaction.
  const client = (state: State) => ({
    billingEvent: {
      // INSERT ... ON CONFLICT DO NOTHING
      createMany: async ({ data }: { data: Array<{ eventId: string }> }) => {
        let count = 0;
        for (const { eventId } of data) {
          if (!state.events.has(eventId)) {
            state.events.add(eventId);
            count += 1;
          }
        }
        return { count };
      },
    },
    subscription: {
      findUnique: async () => {
        const row = state.sub;
        if (db.pause) await new Promise((resolve) => setTimeout(resolve, 15));
        return row;
      },
      upsert: async ({ create, update }: { create: Partial<SubRow>; update: Partial<SubRow> }) => {
        if (db.failUpdate) throw new Error("database unavailable");
        state.sub = state.sub ? { ...(state.sub as SubRow), ...update } : { id: "row-1", ...create };
        return state.sub;
      },
    },
    proPurchase: {
      findUnique: async ({ where }: { where: { providerSubscriptionId: string } }) =>
        (state.purchases as PurchaseRow[]).find((row) => row.providerSubscriptionId === where.providerSubscriptionId) ?? null,
      updateMany: async ({ where, data }: { where: { providerSubscriptionId: string; status: string }; data: Partial<PurchaseRow> }) => {
        const row = (state.purchases as PurchaseRow[]).find((item) => item.providerSubscriptionId === where.providerSubscriptionId && item.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PurchaseRow> }) => {
        const row = (state.purchases as PurchaseRow[]).find((item) => item.id === where.id) as PurchaseRow;
        Object.assign(row, data);
        return row;
      },
    },
  });
  return {
    prisma: {
      ...client(db),
      // A transaction works on a private copy and commits it whole, like a real database. A failed one is
      // thrown away. A Serializable one that finds another transaction committed since it started is rolled
      // back with Prisma's P2034, as Postgres does; any other isolation level silently loses the update.
      $transaction: async (work: (tx: ReturnType<typeof client>) => Promise<unknown>, options?: { isolationLevel?: string }) => {
        const startedAt = db.version;
        const draft: State = {
          events: new Set(db.events),
          sub: db.sub ? { ...(db.sub as SubRow) } : null,
          purchases: purchases().map((row) => ({ ...row })),
        };
        const result = await work(client(draft));
        const lostRace = options?.isolationLevel === "Serializable" && (db.forceConflicts > 0 || db.version !== startedAt);
        if (lostRace) {
          if (db.forceConflicts > 0) db.forceConflicts -= 1;
          db.conflicts += 1;
          throw Object.assign(new Error("Transaction failed due to a write conflict or a deadlock. Please retry your transaction"), { code: "P2034" });
        }
        db.events = draft.events;
        db.sub = draft.sub;
        db.purchases = draft.purchases;
        db.version += 1;
        return result;
      },
    },
  };
});
import { POST } from "@/app/api/billing/webhook/route";
import { signWebhookBody } from "@/lib/billing/razorpay";
import { isSerializationConflict, runSerializable, SERIALIZATION_ATTEMPTS } from "@/lib/billing/subscriptions";

const SECRET = "whsec_test_secret";
const SUB = "sub_Webhook1";
const DAY = 86_400_000;
const NOW = new Date("2026-11-19T12:00:00.000Z");

function deliver(
  event: string,
  options: { eventId?: string | null; signature?: string; secret?: string; raw?: string; subscriptionId?: string } = {},
) {
  const raw =
    options.raw ??
    JSON.stringify({
      event,
      payload: {
        subscription: { entity: { id: options.subscriptionId ?? SUB, status: "active", customer_id: "cust_1" } },
        payment: { entity: { id: "pay_Webhook1" } },
      },
    });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-razorpay-signature": options.signature ?? signWebhookBody(raw, options.secret ?? SECRET),
  };
  if (options.eventId !== null) headers["x-razorpay-event-id"] = options.eventId ?? "evt_1";
  return POST(new Request("http://localhost/api/billing/webhook", { method: "POST", headers, body: raw }));
}

function purchase(extra: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: "purchase-1",
    userId: "user-1",
    providerSubscriptionId: SUB,
    tier: "1m",
    days: 30,
    status: "created",
    providerPaymentId: null,
    paidAt: null,
    accessStart: null,
    accessEnd: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", SECRET);
  db.events.clear();
  db.failUpdate = false;
  db.version = 0;
  db.conflicts = 0;
  db.forceConflicts = 0;
  db.pause = false;
  db.sub = null;
  db.purchases = [purchase()];
  vi.spyOn(console, "error").mockImplementation(() => {});
  return () => vi.useRealTimers();
});

describe("signature and request checks", () => {
  it("rejects a request with no signature", async () => {
    const raw = JSON.stringify({ event: "subscription.activated", payload: {} });
    const response = await POST(
      new Request("http://localhost/api/billing/webhook", { method: "POST", headers: { "x-razorpay-event-id": "evt_1" }, body: raw }),
    );
    expect(response.status).toBe(400);
    expect(db.events.size).toBe(0);
    expect(sub()).toBeNull();
  });

  it("rejects a wrong or forged signature and changes nothing", async () => {
    expect((await deliver("subscription.activated", { signature: "0".repeat(64) })).status).toBe(400);
    expect((await deliver("subscription.activated", { secret: "someone_elses_secret" })).status).toBe(400);
    expect(sub()).toBeNull();
    expect(purchases()[0].status).toBe("created");
  });

  it("rejects a body that was changed after it was signed", async () => {
    const signed = JSON.stringify({ event: "subscription.activated", payload: { subscription: { entity: { id: SUB } } } });
    const response = await deliver("subscription.activated", { raw: signed.replace(SUB, "sub_Other"), signature: signWebhookBody(signed, SECRET) });
    expect(response.status).toBe(400);
  });

  it("needs an event id, and a JSON body", async () => {
    expect((await deliver("subscription.activated", { eventId: null })).status).toBe(400);
    const raw = "not json";
    expect((await deliver("x", { raw })).status).toBe(400);
  });

  it("answers 503 when the webhook secret is not configured", async () => {
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
    expect((await deliver("subscription.activated")).status).toBe(503);
  });
});

describe("granting days from a payment", () => {
  it("adds the purchased days when the payment is activated or charged", async () => {
    for (const event of ["subscription.activated", "subscription.charged"]) {
      db.sub = null;
      db.events.clear();
      db.purchases = [purchase()];
      const response = await deliver(event);
      expect(response.status, event).toBe(200);
      expect((await response.json()).result, event).toBe("granted");
      expect(sub(), event).toMatchObject({
        plan: "pro",
        status: "active",
        tier: "1m",
        providerCustomerId: "cust_1",
        currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
      });
      expect(purchases()[0], event).toMatchObject({ status: "paid", providerPaymentId: "pay_Webhook1" });
    }
  });

  it("grants 60 and 90 days for the 2 and 3 month tiers", async () => {
    for (const [tier, days] of [["2m", 60], ["3m", 90]] as const) {
      db.sub = null;
      db.events.clear();
      db.purchases = [purchase({ tier, days })];
      await deliver("subscription.charged");
      expect(sub()?.currentPeriodEnd, tier).toEqual(new Date(NOW.getTime() + days * DAY));
    }
  });

  it("adds days after the Pro time the user still has", async () => {
    const end = new Date(NOW.getTime() + 4 * DAY);
    db.sub = { id: "row-1", userId: "user-1", providerSubscriptionId: "sub_Old", providerCustomerId: null, plan: "pro", status: "active", currentPeriodEnd: end, cancelAtPeriodEnd: false, tier: "1m" };
    await deliver("subscription.activated");
    expect(sub()?.currentPeriodEnd).toEqual(new Date(end.getTime() + 30 * DAY));
  });

  it("does not add the days twice when verify and the webhook both run for the same payment", async () => {
    await deliver("subscription.activated", { eventId: "evt_a" });
    const first = sub()?.currentPeriodEnd;
    const again = await deliver("subscription.charged", { eventId: "evt_b" });
    expect((await again.json()).result).toBe("already_granted");
    expect(sub()?.currentPeriodEnd).toEqual(first);
  });

  it("ignores a repeated delivery of the same event", async () => {
    await deliver("subscription.activated", { eventId: "evt_same" });
    const first = sub()?.currentPeriodEnd;
    const repeat = await deliver("subscription.activated", { eventId: "evt_same" });
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).result).toBe("duplicate");
    expect(sub()?.currentPeriodEnd).toEqual(first);
  });

  it("does not touch anyone for a subscription it never sold", async () => {
    const response = await deliver("subscription.activated", { subscriptionId: "sub_Unknown" });
    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("unknown_purchase");
    expect(sub()).toBeNull();
    expect(purchases()[0].status).toBe("created");
  });

  it("changes nothing for events that are not a payment, and does not end paid access", async () => {
    const end = new Date(NOW.getTime() + 10 * DAY);
    db.sub = { id: "row-1", userId: "user-1", providerSubscriptionId: SUB, providerCustomerId: null, plan: "pro", status: "active", currentPeriodEnd: end, cancelAtPeriodEnd: false, tier: "1m" };
    for (const [index, event] of ["subscription.authenticated", "subscription.pending", "subscription.halted", "subscription.cancelled", "subscription.completed", "payment.failed"].entries()) {
      const response = await deliver(event, { eventId: `evt_${index}` });
      expect(response.status, event).toBe(200);
      expect((await response.json()).result, event).toBe("ignored");
    }
    expect(sub()).toMatchObject({ status: "active", currentPeriodEnd: end });
    expect(purchases()[0].status).toBe("created");
  });

  it("answers 500 so Razorpay retries when the database fails, and keeps the event unrecorded", async () => {
    db.failUpdate = true;
    const response = await deliver("subscription.activated", { eventId: "evt_retry" });
    expect(response.status).toBe(500);
    expect(db.events.has("evt_retry")).toBe(false);
    expect(purchases()[0].status).toBe("created");

    db.failUpdate = false;
    const retry = await deliver("subscription.activated", { eventId: "evt_retry" });
    expect((await retry.json()).result).toBe("granted");
    expect(sub()?.plan).toBe("pro");
  });
});

describe("two payments for the same user at the same time", () => {
  const SECOND = "sub_Second";
  const second = () => purchase({ id: "purchase-2", providerSubscriptionId: SECOND, tier: "2m", days: 60 });

  it("stacks every purchased day instead of one payment erasing the other", async () => {
    db.purchases = [purchase(), second()];
    db.pause = true; // both transactions read the user's Pro time before either one writes it

    const [first, other] = await Promise.all([
      deliver("subscription.activated", { eventId: "evt_one", subscriptionId: SUB }),
      deliver("subscription.activated", { eventId: "evt_two", subscriptionId: SECOND }),
    ]);

    expect(first.status).toBe(200);
    expect(other.status).toBe(200);
    expect(db.conflicts).toBeGreaterThanOrEqual(1); // one of them lost the race and ran again
    expect(purchases().map((row) => row.status)).toEqual(["paid", "paid"]);
    // 30 + 60 days, not just the longer of the two
    expect(sub()?.currentPeriodEnd).toEqual(new Date(NOW.getTime() + 90 * DAY));
    // the second grant starts exactly where the first one ended
    const [early, late] = [...purchases()].sort((a, b) => (a.accessStart as Date).getTime() - (b.accessStart as Date).getTime());
    expect(early.accessStart).toEqual(NOW);
    expect(late.accessStart).toEqual(early.accessEnd);
    expect(db.events.has("evt_one") && db.events.has("evt_two")).toBe(true);
  });

  it("stacks three at once", async () => {
    db.purchases = [purchase(), second(), purchase({ id: "purchase-3", providerSubscriptionId: "sub_Third", tier: "3m", days: 90 })];
    db.pause = true;
    const responses = await Promise.all([
      deliver("subscription.charged", { eventId: "evt_a", subscriptionId: SUB }),
      deliver("subscription.charged", { eventId: "evt_b", subscriptionId: SECOND }),
      deliver("subscription.charged", { eventId: "evt_c", subscriptionId: "sub_Third" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(sub()?.currentPeriodEnd).toEqual(new Date(NOW.getTime() + 180 * DAY));
  });

  it("still adds the days once when the same payment is delivered twice at the same time", async () => {
    db.pause = true;
    await Promise.all([
      deliver("subscription.activated", { eventId: "evt_x" }),
      deliver("subscription.charged", { eventId: "evt_y" }),
    ]);
    expect(sub()?.currentPeriodEnd).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(purchases()[0].status).toBe("paid");
  });

  it("answers 500 for Razorpay to retry if it keeps losing the race, keeping nothing", async () => {
    db.forceConflicts = 1000;
    const response = await deliver("subscription.activated", { eventId: "evt_busy" });
    expect(response.status).toBe(500);
    expect(db.conflicts).toBe(SERIALIZATION_ATTEMPTS);
    expect(db.events.has("evt_busy")).toBe(false);
    expect(purchases()[0].status).toBe("created");
    expect(sub()).toBeNull();

    db.forceConflicts = 0;
    const retry = await deliver("subscription.activated", { eventId: "evt_busy" });
    expect((await retry.json()).result).toBe("granted");
    expect(sub()?.currentPeriodEnd).toEqual(new Date(NOW.getTime() + 30 * DAY));
  });
});

describe("runSerializable", () => {
  const conflict = () => Object.assign(new Error("write conflict"), { code: "P2034" });

  it("recognises only Prisma's serialization conflict", () => {
    expect(isSerializationConflict(conflict())).toBe(true);
    expect(isSerializationConflict(Object.assign(new Error("x"), { code: "P2002" }))).toBe(false);
    expect(isSerializationConflict(new Error("plain"))).toBe(false);
    expect(isSerializationConflict(null)).toBe(false);
    expect(isSerializationConflict("P2034")).toBe(false);
  });

  it("asks for Serializable isolation and returns the result", async () => {
    const transaction = vi.fn<(work: (tx: never) => Promise<string>, options?: { isolationLevel?: string }) => Promise<string>>(async (work) => work({} as never));
    await expect(runSerializable({ $transaction: transaction } as never, async () => "done")).resolves.toBe("done");
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("runs again after a conflict and stops after the last allowed attempt", async () => {
    const flaky = vi.fn().mockRejectedValueOnce(conflict()).mockRejectedValueOnce(conflict()).mockResolvedValue("ok");
    await expect(runSerializable({ $transaction: flaky } as never, async () => "ok")).resolves.toBe("ok");
    expect(flaky).toHaveBeenCalledTimes(3);

    const always = vi.fn().mockRejectedValue(conflict());
    await expect(runSerializable({ $transaction: always } as never, async () => "ok", 3)).rejects.toMatchObject({ code: "P2034" });
    expect(always).toHaveBeenCalledTimes(3);
  });

  it("does not retry any other error", async () => {
    const broken = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(runSerializable({ $transaction: broken } as never, async () => "ok")).rejects.toThrow("database unavailable");
    expect(broken).toHaveBeenCalledTimes(1);
  });
});