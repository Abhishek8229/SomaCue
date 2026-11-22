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
}));

const sub = () => db.sub as SubRow | null;
const purchases = () => db.purchases as PurchaseRow[];

vi.mock("@/lib/db/prisma", () => {
  const client = () => ({
    billingEvent: {
      // INSERT ... ON CONFLICT DO NOTHING
      createMany: async ({ data }: { data: Array<{ eventId: string }> }) => {
        let count = 0;
        for (const { eventId } of data) {
          if (!db.events.has(eventId)) {
            db.events.add(eventId);
            count += 1;
          }
        }
        return { count };
      },
    },
    subscription: {
      findUnique: async () => db.sub,
      upsert: async ({ create, update }: { create: Partial<SubRow>; update: Partial<SubRow> }) => {
        if (db.failUpdate) throw new Error("database unavailable");
        db.sub = db.sub ? { ...(db.sub as SubRow), ...update } : { id: "row-1", ...create };
        return db.sub;
      },
    },
    proPurchase: {
      findUnique: async ({ where }: { where: { providerSubscriptionId: string } }) =>
        purchases().find((row) => row.providerSubscriptionId === where.providerSubscriptionId) ?? null,
      updateMany: async ({ where, data }: { where: { providerSubscriptionId: string; status: string }; data: Partial<PurchaseRow> }) => {
        const row = purchases().find((item) => item.providerSubscriptionId === where.providerSubscriptionId && item.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<PurchaseRow> }) => {
        const row = purchases().find((item) => item.id === where.id) as PurchaseRow;
        Object.assign(row, data);
        return row;
      },
    },
  });
  return {
    prisma: {
      ...client(),
      // A failed transaction undoes what it wrote, including the event row.
      $transaction: async (work: (tx: ReturnType<typeof client>) => Promise<unknown>) => {
        const eventsBefore = [...db.events];
        const subBefore = db.sub ? { ...(db.sub as SubRow) } : null;
        const purchasesBefore = purchases().map((row) => ({ ...row }));
        try {
          return await work(client());
        } catch (error) {
          db.events.clear();
          for (const id of eventsBefore) db.events.add(id);
          db.sub = subBefore;
          db.purchases = purchasesBefore;
          throw error;
        }
      },
    },
  };
});

import { POST } from "@/app/api/billing/webhook/route";
import { signWebhookBody } from "@/lib/billing/razorpay";

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
