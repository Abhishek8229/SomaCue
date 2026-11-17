// @vitest-environment node
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  email: string;
  name: string;
  role: string;
  passwordHash: string | null;
  googleId: string | null;
};

const { users, cookieSets } = vi.hoisted(() => ({
  users: new Map<string, Row>(),
  cookieSets: [] as { name: string; value: string; options: Record<string, unknown> }[],
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { email?: string } }) => users.get(where.email ?? "") ?? null,
      create: async ({ data }: { data: Omit<Row, "id" | "googleId"> }) => {
        const row: Row = { id: `user-${users.size + 1}`, googleId: null, ...data };
        users.set(row.email, row);
        return { id: row.id, email: row.email, name: row.name, role: row.role };
      },
    },
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    delete: () => {},
    set: (name: string, value: string, options: Record<string, unknown>) => {
      cookieSets.push({ name, value, options });
    },
  }),
}));

import { GET as googleStart } from "@/app/api/auth/google/route";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as register } from "@/app/api/auth/register/route";
import { OAUTH_STATE_COOKIE, signOAuthState } from "@/lib/auth/google";
import { clearRateLimits } from "@/lib/auth/rateLimit";

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;

function post(path: string, body: unknown, ip: string = nextIp()) {
  return new Request(`http://localhost:3100${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  users.clear();
  cookieSets.length = 0;
  clearRateLimits();
  vi.unstubAllEnvs();
});

describe("POST /api/auth/register", () => {
  it("rejects a password without a number", async () => {
    const response = await register(post("/api/auth/register", { name: "Asha", email: "a@example.com", password: "onlyletters" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "password" });
    expect(users.size).toBe(0);
  });

  it("normalizes the email, sets a hardened session cookie and returns a safe next path", async () => {
    const response = await register(
      post("/api/auth/register", { name: " Asha Rao ", email: "  Asha@Example.COM ", password: "Rehab2026", next: "https://evil.example" }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.user.email).toBe("asha@example.com");
    expect(body.next).toBe("/workspace");

    const session = cookieSets.find((cookie) => cookie.name === "somacue_session");
    expect(session?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(users.get("asha@example.com")?.passwordHash).not.toBe("Rehab2026");
  });

  it("refuses a duplicate email, including one that is Google-only", async () => {
    users.set("g@example.com", { id: "u1", email: "g@example.com", name: "G", role: "patient", passwordHash: null, googleId: "sub" });
    const response = await register(post("/api/auth/register", { name: "G", email: "G@example.com", password: "Rehab2026" }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/Google/) });
  });

  it("rate-limits repeat registrations from one address", async () => {
    const ip = nextIp();
    const attempt = () => register(post("/api/auth/register", { name: "A", email: "dup@example.com", password: "Rehab2026" }, ip));
    expect((await attempt()).status).toBe(201);
    expect((await attempt()).status).toBe(409);
    expect((await attempt()).status).toBe(409);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    users.set("local@example.com", {
      id: "u1",
      email: "local@example.com",
      name: "Local User",
      role: "patient",
      passwordHash: await bcrypt.hash("Rehab2026", 4),
      googleId: null,
    });
    users.set("google@example.com", { id: "u2", email: "google@example.com", name: "Google User", role: "patient", passwordHash: null, googleId: "sub-2" });
  });

  it("signs in with a normalized email and returns the validated next path", async () => {
    const response = await login(post("/api/auth/login", { email: " Local@Example.com ", password: "Rehab2026", next: "/dashboard" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, next: "/dashboard" });
    expect(cookieSets.some((cookie) => cookie.name === "somacue_session")).toBe(true);
  });

  it("does not follow an off-site next path", async () => {
    const response = await login(post("/api/auth/login", { email: "local@example.com", password: "Rehab2026", next: "//evil.example" }));
    await expect(response.json()).resolves.toMatchObject({ next: "/workspace" });
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const wrong = await login(post("/api/auth/login", { email: "local@example.com", password: "Wrong2026" }));
    const unknown = await login(post("/api/auth/login", { email: "nobody@example.com", password: "Wrong2026" }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error).toBe((await unknown.json()).error);
  });

  it("tells a Google-only account to use Google instead of reporting a bad password", async () => {
    const response = await login(post("/api/auth/login", { email: "google@example.com", password: "Rehab2026" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "google_only", error: expect.stringMatching(/Continue with Google/) });
  });

  it("blocks the sixth attempt for the same address and email", async () => {
    const ip = nextIp();
    const attempt = () => login(post("/api/auth/login", { email: "local@example.com", password: "Wrong2026" }, ip));
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({ error: expect.stringMatching(/Too many attempts/) });
  });
});

describe("Google routes", () => {
  it("send people back to the sign-in page with a friendly message when Google is not set up", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const response = await googleStart(new Request("http://localhost:3100/api/auth/google?next=/dashboard"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("google_not_configured");
    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("start the flow with a signed, http-only state cookie and a safe next path", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3100");
    const response = await googleStart(new Request("http://localhost:3100/api/auth/google?next=//evil.example"));
    const location = new URL(response.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:3100/api/auth/google/callback");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${OAUTH_STATE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("callback rejects a state that does not match the cookie", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    const token = await signOAuthState({ state: "expected", nonce: "n", verifier: "v", next: "/dashboard" });
    const response = await googleCallback(
      new Request("http://localhost:3100/api/auth/google/callback?code=abc&state=forged", {
        headers: { cookie: `${OAUTH_STATE_COOKIE}=${token}` },
      }),
    );
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("google_state");
    expect(cookieSets.some((cookie) => cookie.name === "somacue_session")).toBe(false);
  });

  it("callback rejects a request with no state cookie at all", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    const response = await googleCallback(new Request("http://localhost:3100/api/auth/google/callback?code=abc&state=x"));
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("google_state");
  });

  it("callback reports a cancelled Google prompt", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    const token = await signOAuthState({ state: "s", nonce: "n", verifier: "v", next: "/workspace" });
    const response = await googleCallback(
      new Request("http://localhost:3100/api/auth/google/callback?error=access_denied", {
        headers: { cookie: `${OAUTH_STATE_COOKIE}=${token}` },
      }),
    );
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("google_cancelled");
  });
});
