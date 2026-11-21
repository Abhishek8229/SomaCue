// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

type SubRow = {
  id: string;
  userId: string;
  provider: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
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
  amountMinor: number;
  status: string;
  providerPaymentId: string | null;
  paidAt: Date | null;
  accessStart: Date | null;
  accessEnd: Date | null;
  createdAt: Date;
};

const db = vi.hoisted(() => ({
  user: { id: "user-1", name: "Asha", email: "asha@example.com" } as { id: string; name: string; email: string } | null,
  sub: null as unknown,
  purchases: [] as unknown[],
  analyses: 0,
  messages: 0,
}));
const sub = () => db.sub as SubRow | null;
const purchases = () => db.purchases as PurchaseRow[];

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => db.user }));
vi.mock("@/lib/db/prisma", () => {
  const client = () => ({
    subscription: {
      findUnique: async () => db.sub,
      upsert: async ({ create, update }: { create: Partial<SubRow>; update: Partial<SubRow> }) => {
        db.sub = db.sub ? { ...(db.sub as SubRow), ...update } : { id: "row-1", ...create };
        return db.sub;
      },
    },
    proPurchase: {
      findUnique: async ({ where }: { where: { providerSubscriptionId: string } }) =>
        purchases().find((row) => row.providerSubscriptionId === where.providerSubscriptionId) ?? null,
      findFirst: async ({ where }: { where: { userId: string; tier: string; status: string } }) =>
        purchases()
          .filter((row) => row.userId === where.userId && row.tier === where.tier && row.status === where.status)
          .at(-1) ?? null,
      create: async ({ data }: { data: Partial<PurchaseRow> }) => {
        const row = {
          id: `purchase-${purchases().length + 1}`,
          status: "created",
          providerPaymentId: null,
          paidAt: null,
          accessStart: null,
          accessEnd: null,
          createdAt: new Date(),
          ...data,
        } as PurchaseRow;
        db.purchases.push(row);
        return row;
      },
      // UPDATE ... WHERE status = 'created': the one-time flip
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
    clinicalReport: { count: async () => db.analyses },
    chatMessage: { count: async () => db.messages },
  });
  return { prisma: { ...client(), $transaction: async (work: (tx: ReturnType<typeof client>) => Promise<unknown>) => work(client()) } };
});

import { GET as getStatus } from "@/app/api/billing/status/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as verify } from "@/app/api/billing/verify/route";
import { clearPlanCache, signCheckout } from "@/lib/billing/razorpay";
import { clearRateLimits } from "@/lib/auth/rateLimit";

const KEY_SECRET = "test_key_secret";
const SUB = "sub_Route1";
const PAY = "pay_Route1";
const DAY = 86_400_000;
const NOW = new Date("2026-11-19T12:00:00.000Z");

type RemoteSubscription = Record<string, unknown>;
const razorpay = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; path: string; body: unknown }>,
  subscription: {} as RemoteSubscription,
  plans: [] as Array<Record<string, unknown>>,
  /** plans that exist in the account, by id (what GET /plans/:id returns) */
  configured: {} as Record<string, Record<string, unknown>>,
  failWith: null as null | { status: number; description: string },
}));

function remote(extra: RemoteSubscription = {}): RemoteSubscription {
  return { id: SUB, status: "active", plan_id: "plan_1m", customer_id: "cust_1", notes: { user_id: "user-1" }, ...extra };
}

function purchase(extra: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    id: "purchase-1",
    userId: "user-1",
    providerSubscriptionId: SUB,
    tier: "1m",
    days: 30,
    amountMinor: 19900,
    status: "created",
    providerPaymentId: null,
    paidAt: null,
    accessStart: null,
    accessEnd: null,
    createdAt: new Date(),
    ...extra,
  };
}

function proRow(end: Date, extra: Partial<SubRow> = {}): SubRow {
  return {
    id: "row-1",
    userId: "user-1",
    provider: "razorpay",
    providerCustomerId: "cust_0",
    providerSubscriptionId: "sub_Old",
    plan: "pro",
    status: "active",
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    tier: "1m",
    ...extra,
  };
}

const json = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const fetchCalls = () => razorpay.calls.map((call) => `${call.method} ${call.path}`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc123");
  vi.stubEnv("RAZORPAY_KEY_SECRET", KEY_SECRET);
  vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_1m");
  vi.stubEnv("RAZORPAY_PRO_PLAN_2M_ID", "");
  vi.stubEnv("RAZORPAY_PRO_PLAN_3M_ID", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.user = { id: "user-1", name: "Asha", email: "asha@example.com" };
  db.sub = null;
  db.purchases = [];
  db.analyses = 0;
  db.messages = 0;
  razorpay.calls.length = 0;
  razorpay.subscription = remote();
  razorpay.plans = [];
  const planOf = (id: string, interval: number, amount: number) => ({ id, period: "monthly", interval, item: { amount, currency: "INR" } });
  razorpay.configured = {
    plan_1m: planOf("plan_1m", 1, 19900),
    plan_env_2m: planOf("plan_env_2m", 2, 29900),
    plan_env_3m: planOf("plan_env_3m", 3, 34900),
    plan_old_299: planOf("plan_old_299", 1, 29900),
  };
  razorpay.failWith = null;
  clearRateLimits();
  clearPlanCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const path = `${parsed.pathname.replace(/^\/v1/, "")}${parsed.search}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      razorpay.calls.push({ method: init?.method ?? "GET", path, body });
      if (razorpay.failWith) {
        return Response.json({ error: { code: "BAD_REQUEST_ERROR", description: razorpay.failWith.description } }, { status: razorpay.failWith.status });
      }
      const byId = /^\/plans\/([^?]+)$/.exec(path);
      if (byId) {
        const plan = razorpay.configured[byId[1]];
        return plan ? Response.json(plan) : Response.json({ error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } }, { status: 400 });
      }
      if (path.startsWith("/plans?")) return Response.json({ items: razorpay.plans });
      if (path === "/plans") {
        const plan = { id: `plan_new_${body.interval}`, period: body.period, interval: body.interval, item: body.item };
        razorpay.plans.push(plan);
        return Response.json(plan);
      }
      return Response.json(razorpay.subscription);
    }),
  );
  return () => vi.useRealTimers();
});

describe("GET /api/billing/status", () => {
  it("needs a signed-in user", async () => {
    db.user = null;
    expect((await getStatus()).status).toBe(401);
  });

  it("reports Free with the remaining usage", async () => {
    db.analyses = 1;
    db.messages = 2;
    expect(await (await getStatus()).json()).toMatchObject({
      plan: "free",
      status: null,
      tier: null,
      usage: { analysesRemaining: 0, companionMessagesRemaining: 1, scheduleDays: 7 },
    });
  });

  it("reports Pro with the access end date and the tier", async () => {
    const end = new Date(NOW.getTime() + 40 * DAY);
    db.sub = proRow(end, { tier: "2m" });
    expect(await (await getStatus()).json()).toMatchObject({ plan: "pro", currentPeriodEnd: end.toISOString(), tier: "2m" });
  });
});

describe("POST /api/billing/checkout", () => {
  it("needs a signed-in user", async () => {
    db.user = null;
    expect((await checkout(json({ tier: "1m" }))).status).toBe(401);
    expect(razorpay.calls).toHaveLength(0);
  });

  it("rejects a missing or unknown tier before calling Razorpay", async () => {
    for (const body of [{}, { tier: "4m" }, { tier: 1 }, { tier: "1m ", amount: 1 }]) {
      expect((await checkout(json(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await checkout(new Request("http://localhost/api", { method: "POST", body: "nope" }))).status).toBe(400);
    expect(razorpay.calls).toHaveLength(0);
  });

  it("starts the 1 month tier on RAZORPAY_PRO_PLAN_ID as one single-cycle payment, tagged with user and tier", async () => {
    razorpay.subscription = remote({ status: "created", customer_id: null });
    const response = await checkout(json({ tier: "1m" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subscriptionId: SUB, keyId: "rzp_test_abc123", tier: "1m", amountMinor: 19900 });
    // the configured plan is checked against the tier's price first, then used
    expect(fetchCalls()).toEqual(["GET /plans/plan_1m", "POST /subscriptions"]);
    expect(razorpay.calls.at(-1)).toEqual({
      method: "POST",
      path: "/subscriptions",
      body: { plan_id: "plan_1m", total_count: 1, customer_notify: 1, notes: { user_id: "user-1", tier: "1m" } },
    });
    expect(purchases()).toHaveLength(1);
    expect(purchases()[0]).toMatchObject({ userId: "user-1", tier: "1m", days: 30, amountMinor: 19900, status: "created" });
  });

  it("uses the optional plan id for 2 and 3 months when it is set, without creating plans", async () => {
    vi.stubEnv("RAZORPAY_PRO_PLAN_2M_ID", "plan_env_2m");
    vi.stubEnv("RAZORPAY_PRO_PLAN_3M_ID", "plan_env_3m");
    razorpay.subscription = remote({ status: "created" });
    await checkout(json({ tier: "2m" }));
    await checkout(json({ tier: "3m" }));
    expect(razorpay.calls.map((call) => (call.body as { plan_id?: string })?.plan_id).filter(Boolean)).toEqual(["plan_env_2m", "plan_env_3m"]);
    expect(fetchCalls().filter((call) => call === "POST /plans")).toEqual([]);
  });

  it("creates the ₹299 and ₹349 plans through the Razorpay API when none is configured, and reuses them", async () => {
    razorpay.subscription = remote({ status: "created" });
    const two = await (await checkout(json({ tier: "2m" }))).json();
    expect(two).toMatchObject({ tier: "2m", amountMinor: 29900 });
    const created = razorpay.calls.find((call) => call.method === "POST" && call.path === "/plans");
    expect(created?.body).toMatchObject({ period: "monthly", interval: 2, item: { amount: 29900, currency: "INR" }, notes: { tier: "2m" } });

    await checkout(json({ tier: "3m" }));
    const plans = razorpay.calls.filter((call) => call.method === "POST" && call.path === "/plans");
    expect(plans.map((call) => (call.body as { item: { amount: number } }).item.amount)).toEqual([29900, 34900]);

    // A second 2 month checkout finds the plan it made: no third plan, and the subscription uses it.
    razorpay.calls.length = 0;
    purchases().forEach((row) => (row.status = "paid"));
    await checkout(json({ tier: "2m" }));
    expect(fetchCalls()).toEqual(["POST /subscriptions"]);
    expect((razorpay.calls[0].body as { plan_id: string }).plan_id).toBe("plan_new_2");
    expect(razorpay.calls[0].body).toMatchObject({ total_count: 1 });
  });

  it("does not reuse the old ₹299 plan for the ₹199 month: a plan id with the wrong price is ignored", async () => {
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_old_299");
    razorpay.subscription = remote({ status: "created" });
    await checkout(json({ tier: "1m" }));
    const created = razorpay.calls.find((call) => call.method === "POST" && call.path === "/plans");
    expect(created?.body).toMatchObject({ period: "monthly", interval: 1, item: { amount: 19900, currency: "INR" } });
    const subscription = razorpay.calls.find((call) => call.method === "POST" && call.path === "/subscriptions");
    expect((subscription?.body as { plan_id: string }).plan_id).toBe("plan_new_1");
  });

  it("ignores a plan id that does not exist, and a plan for the wrong length", async () => {
    vi.stubEnv("RAZORPAY_PRO_PLAN_ID", "plan_gone");
    vi.stubEnv("RAZORPAY_PRO_PLAN_2M_ID", "plan_env_3m"); // a 3 month plan configured for 2 months
    razorpay.subscription = remote({ status: "created" });
    await checkout(json({ tier: "1m" }));
    await checkout(json({ tier: "2m" }));
    const plans = razorpay.calls.filter((call) => call.method === "POST" && call.path === "/plans");
    expect(plans.map((call) => (call.body as { item: { amount: number } }).item.amount)).toEqual([19900, 29900]);
  });

  it("takes the price and days from the server, never from the request", async () => {
    razorpay.subscription = remote({ status: "created" });
    await checkout(json({ tier: "3m", amountMinor: 100, days: 9999 }));
    expect(purchases()[0]).toMatchObject({ tier: "3m", days: 90, amountMinor: 34900 });
  });

  it("lets a user who still has Pro buy again, and leaves their current access untouched", async () => {
    const end = new Date(NOW.getTime() + 5 * DAY);
    db.sub = proRow(end);
    razorpay.subscription = remote({ id: "sub_Renew", status: "created" });
    const response = await checkout(json({ tier: "2m" }));
    expect(response.status).toBe(200);
    expect(sub()).toMatchObject({ plan: "pro", status: "active", currentPeriodEnd: end, providerSubscriptionId: "sub_Old" });
  });

  it("never sends the key secret to the browser", async () => {
    razorpay.subscription = remote({ status: "created" });
    expect(await (await checkout(json({ tier: "1m" }))).text()).not.toContain(KEY_SECRET);
  });

  it("reuses a recent unpaid checkout of the same tier instead of creating another", async () => {
    db.purchases = [purchase()];
    razorpay.subscription = remote({ status: "created" });
    const response = await checkout(json({ tier: "1m" }));
    expect(await response.json()).toMatchObject({ subscriptionId: SUB, tier: "1m" });
    expect(fetchCalls()).toEqual([`GET /subscriptions/${SUB}`]);
    expect(purchases()).toHaveLength(1);
  });

  it("does not reuse an unpaid checkout of another tier", async () => {
    db.purchases = [purchase({ tier: "1m" })];
    razorpay.subscription = remote({ id: "sub_Two", status: "created" });
    vi.stubEnv("RAZORPAY_PRO_PLAN_2M_ID", "plan_env_2m");
    await checkout(json({ tier: "2m" }));
    expect(purchases().map((row) => row.tier)).toEqual(["1m", "2m"]);
  });

  it("is rate limited", async () => {
    razorpay.subscription = remote({ status: "created" });
    let last = 200;
    for (let i = 0; i < 9; i += 1) last = (await checkout(json({ tier: "1m" }))).status;
    expect(last).toBe(429);
  });

  it("answers 503 when Razorpay keys are not configured, without calling Razorpay", async () => {
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
    expect((await checkout(json({ tier: "1m" }))).status).toBe(503);
    expect(razorpay.calls).toHaveLength(0);
  });

  it("answers 502 without leaking Razorpay's wording when the provider fails", async () => {
    razorpay.failWith = { status: 400, description: "internal detail about the account" };
    const response = await checkout(json({ tier: "1m" }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("internal detail");
    expect(purchases()).toHaveLength(0);
  });
});

describe("POST /api/billing/verify", () => {
  const good = () => ({
    razorpay_payment_id: PAY,
    razorpay_subscription_id: SUB,
    razorpay_signature: signCheckout(PAY, SUB, KEY_SECRET),
  });

  beforeEach(() => {
    db.purchases = [purchase()];
  });

  it("needs a signed-in user", async () => {
    db.user = null;
    expect((await verify(json(good()))).status).toBe(401);
  });

  it("rejects a malformed body", async () => {
    expect((await verify(json({ razorpay_payment_id: PAY }))).status).toBe(400);
    expect((await verify(new Request("http://localhost/api", { method: "POST", body: "nope" }))).status).toBe(400);
  });

  it("grants exactly 30 days for the 1 month tier, from now", async () => {
    const response = await verify(json(good()));
    expect(response.status).toBe(200);
    const end = new Date(NOW.getTime() + 30 * DAY);
    expect((await response.json()).billing).toMatchObject({ plan: "pro", status: "active", tier: "1m", currentPeriodEnd: end.toISOString() });
    expect(sub()).toMatchObject({ plan: "pro", status: "active", providerCustomerId: "cust_1", currentPeriodEnd: end, tier: "1m", cancelAtPeriodEnd: false });
    expect(purchases()[0]).toMatchObject({ status: "paid", providerPaymentId: PAY, accessStart: NOW, accessEnd: end });
  });

  it("grants exactly 60 days for 2 months and exactly 90 days for 3 months", async () => {
    for (const [tier, days] of [["2m", 60], ["3m", 90]] as const) {
      db.sub = null;
      db.purchases = [purchase({ tier, days })];
      await verify(json(good()));
      expect(sub()?.currentPeriodEnd, tier).toEqual(new Date(NOW.getTime() + days * DAY));
      expect(sub()?.tier, tier).toBe(tier);
    }
  });

  it("adds the new days after the Pro time the user still has when they renew early", async () => {
    const end = new Date(NOW.getTime() + 5 * DAY);
    db.sub = proRow(end);
    db.purchases = [purchase({ tier: "2m", days: 60 })];
    await verify(json(good()));
    expect(sub()?.currentPeriodEnd).toEqual(new Date(end.getTime() + 60 * DAY));
    expect(purchases()[0]).toMatchObject({ accessStart: end });
  });

  it("starts from now when the earlier Pro time has already ended", async () => {
    db.sub = proRow(new Date(NOW.getTime() - 3 * DAY));
    await verify(json(good()));
    expect(sub()?.currentPeriodEnd).toEqual(new Date(NOW.getTime() + 30 * DAY));
  });

  it("is safe to repeat: the same payment adds its days once", async () => {
    await verify(json(good()));
    const first = sub()?.currentPeriodEnd;
    razorpay.calls.length = 0;
    const again = await verify(json(good()));
    expect(again.status).toBe(200);
    expect(sub()?.currentPeriodEnd).toEqual(first);
    expect(razorpay.calls).toHaveLength(0);
  });

  it("does NOT unlock Pro for a wrong signature", async () => {
    const response = await verify(json({ ...good(), razorpay_signature: "0".repeat(64) }));
    expect(response.status).toBe(400);
    expect(sub()).toBeNull();
    expect(purchases()[0].status).toBe("created");
    expect(razorpay.calls).toHaveLength(0);
  });

  it("does NOT unlock Pro when the signature is for the wrong parts", async () => {
    const swapped = signCheckout(SUB, PAY, KEY_SECRET);
    expect((await verify(json({ ...good(), razorpay_signature: swapped }))).status).toBe(400);
    expect(sub()).toBeNull();
  });

  it("rejects a valid payment for a purchase that is not this user's", async () => {
    db.purchases = [purchase({ userId: "user-2" })];
    expect((await verify(json(good()))).status).toBe(403);
    expect(sub()).toBeNull();
  });

  it("rejects it when there is no such purchase at all", async () => {
    db.purchases = [];
    expect((await verify(json(good()))).status).toBe(403);
  });

  it("rejects a subscription Razorpay says belongs to another user", async () => {
    razorpay.subscription = remote({ notes: { user_id: "user-2" } });
    expect((await verify(json(good()))).status).toBe(403);
    expect(sub()).toBeNull();
  });

  it("does not grant days for a subscription that was cancelled or failed", async () => {
    for (const status of ["cancelled", "halted", "expired", "pending"]) {
      razorpay.subscription = remote({ status });
      db.purchases = [purchase()];
      const response = await verify(json(good()));
      expect(response.status, status).toBe(409);
      expect(sub(), status).toBeNull();
    }
  });

  it("accepts the moment before Razorpay's own status catches up, and a single-cycle one that already completed", async () => {
    for (const status of ["authenticated", "completed"]) {
      db.sub = null;
      db.purchases = [purchase()];
      razorpay.subscription = remote({ status });
      expect((await verify(json(good()))).status, status).toBe(200);
      expect(sub()?.plan, status).toBe("pro");
    }
  });
});
