// @vitest-environment node
import { createHash } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { users } = vi.hoisted(() => ({
  users: new Map<
    string,
    { id: string; email: string; name: string; role: string; googleId: string | null; avatarUrl: string | null; passwordHash: string | null }
  >(),
}));

vi.mock("@/lib/db/prisma", () => {
  const byField = (field: "email" | "googleId", value: string) =>
    [...users.values()].find((user) => user[field] === value) ?? null;
  const pick = (user: ReturnType<typeof byField>) =>
    user && { id: user.id, email: user.email, name: user.name, role: user.role, googleId: user.googleId };
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: { where: { email?: string; googleId?: string } }) =>
          pick(where.googleId ? byField("googleId", where.googleId) : byField("email", where.email ?? "")),
        update: async ({ where, data }: { where: { id: string }; data: Partial<{ googleId: string; avatarUrl: string | null; name: string; email: string }> }) => {
          const user = [...users.values()].find((entry) => entry.id === where.id)!;
          // the email column is unique
          if (data.email && [...users.values()].some((entry) => entry.email === data.email && entry.id !== user.id)) {
            throw new Error("Unique constraint failed on the fields: (`email`)");
          }
          Object.assign(user, data);
          return pick(user);
        },
        create: async ({ data }: { data: { email: string; name: string; role: string; googleId: string; avatarUrl: string | null } }) => {
          const record = { id: `user-${users.size + 1}`, passwordHash: null, ...data };
          users.set(record.id, record);
          return pick(record);
        },
      },
    },
  };
});

import {
  buildGoogleAuthUrl,
  createPkce,
  exchangeCodeForIdToken,
  getAppOrigin,
  getGoogleConfig,
  googleRedirectUri,
  readOAuthState,
  signOAuthState,
  statesMatch,
  verifyGoogleIdToken,
} from "@/lib/auth/google";
import { signInWithGoogleProfile } from "@/lib/auth/oauthAccount";

const CLIENT_ID = "test-client.apps.googleusercontent.com";

describe("google config and urls", () => {
  it("is off until both values are set", () => {
    expect(getGoogleConfig({})).toBeNull();
    expect(getGoogleConfig({ GOOGLE_CLIENT_ID: "id" })).toBeNull();
    expect(getGoogleConfig({ GOOGLE_CLIENT_ID: " id ", GOOGLE_CLIENT_SECRET: " secret " })).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("prefers NEXT_PUBLIC_APP_URL and falls back to the request origin", () => {
    const request = new Request("http://internal:3000/api/auth/google");
    expect(getAppOrigin(request, { NEXT_PUBLIC_APP_URL: "https://app.somacue.example/" })).toBe(
      "https://app.somacue.example",
    );
    expect(getAppOrigin(request, {})).toBe("http://internal:3000");
    expect(googleRedirectUri("https://app.somacue.example")).toBe(
      "https://app.somacue.example/api/auth/google/callback",
    );
  });

  it("builds an authorization URL with state, nonce and an S256 PKCE challenge", () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));

    const url = new URL(
      buildGoogleAuthUrl({
        clientId: CLIENT_ID,
        redirectUri: "http://localhost:3100/api/auth/google/callback",
        state: "state-1",
        nonce: "nonce-1",
        challenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("signed state cookie", () => {
  const payload = { state: "s", nonce: "n", verifier: "v", next: "/dashboard" };

  it("round-trips what the callback needs", async () => {
    const token = await signOAuthState(payload);
    await expect(readOAuthState(token)).resolves.toEqual(payload);
  });

  it("rejects a missing, garbled or tampered cookie", async () => {
    expect(await readOAuthState(undefined)).toBeNull();
    expect(await readOAuthState("not-a-jwt")).toBeNull();

    const token = await signOAuthState(payload);
    const [header, body, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, next: "https://evil.example" })).toString("base64url");
    expect(await readOAuthState(`${header}.${forged}.${signature}`)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it("compares the returned state in constant time and rejects a mismatch", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch("abc", null)).toBe(false);
  });
});

describe("code exchange", () => {
  const input = {
    code: "auth-code",
    verifier: "verifier-1",
    redirectUri: "http://localhost:3100/api/auth/google/callback",
    config: { clientId: CLIENT_ID, clientSecret: "secret" },
  };

  it("posts the code with the PKCE verifier and returns the ID token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id_token: "the.id.token" }), { status: 200 }));
    await expect(exchangeCodeForIdToken(input, fetchMock as unknown as typeof fetch)).resolves.toBe("the.id.token");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier-1");
    expect(body.get("client_secret")).toBe("secret");
  });

  it("fails when Google rejects the code or sends no ID token", async () => {
    const rejected = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(exchangeCodeForIdToken(input, rejected as unknown as typeof fetch)).rejects.toThrow(/400/);
    const empty = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(exchangeCodeForIdToken(input, empty as unknown as typeof fetch)).rejects.toThrow(/ID token/);
  });
});

describe("ID token verification", () => {
  let privateKey: CryptoKey;
  let keys: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
    keys = createLocalJWKSet({ keys: [jwk] });
  });

  const sign = (claims: Record<string, unknown>, options: { issuer?: string; audience?: string; expires?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(options.issuer ?? "https://accounts.google.com")
      .setAudience(options.audience ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(options.expires ?? "5m")
      .sign(privateKey);

  const claims = { sub: "google-sub-1", email: "Patient@Example.com", email_verified: true, name: "Asha Rao", picture: "https://img.example/a.png", nonce: "n-1" };

  it("returns the profile for a valid token", async () => {
    const profile = await verifyGoogleIdToken(await sign(claims), { clientId: CLIENT_ID, nonce: "n-1" }, keys);
    expect(profile).toEqual({
      sub: "google-sub-1",
      email: "patient@example.com",
      emailVerified: true,
      name: "Asha Rao",
      picture: "https://img.example/a.png",
    });
  });

  it("rejects a wrong nonce, audience, issuer or an expired token", async () => {
    const expected = { clientId: CLIENT_ID, nonce: "n-1" };
    await expect(verifyGoogleIdToken(await sign({ ...claims, nonce: "other" }), expected, keys)).rejects.toThrow(/nonce/);
    await expect(verifyGoogleIdToken(await sign(claims, { audience: "someone-else" }), expected, keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(await sign(claims, { issuer: "https://evil.example" }), expected, keys)).rejects.toThrow();
    await expect(verifyGoogleIdToken(await sign(claims, { expires: "-1m" }), expected, keys)).rejects.toThrow();
  });

  it("rejects a token signed with a different key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verifyGoogleIdToken(forged, { clientId: CLIENT_ID, nonce: "n-1" }, keys)).rejects.toThrow();
  });

  it("reads email_verified false as unverified", async () => {
    const profile = await verifyGoogleIdToken(
      await sign({ ...claims, email_verified: false }),
      { clientId: CLIENT_ID, nonce: "n-1" },
      keys,
    );
    expect(profile.emailVerified).toBe(false);
  });
});

describe("account linking", () => {
  const profile = {
    sub: "google-sub-1",
    email: "patient@example.com",
    emailVerified: true,
    name: "Asha Rao",
    picture: "https://img.example/a.png",
  };

  beforeEach(() => users.clear());

  it("creates a patient with no password for a new Google user", async () => {
    const result = await signInWithGoogleProfile(profile);
    expect(result).toMatchObject({ ok: true, outcome: "created", user: { email: "patient@example.com", name: "Asha Rao", role: "patient" } });
    const stored = [...users.values()][0];
    expect(stored.passwordHash).toBeNull();
    expect(stored.googleId).toBe("google-sub-1");
    expect(stored.avatarUrl).toBe("https://img.example/a.png");
  });

  it("links Google to an account that predates Google-only sign-in, and saves the Google profile on it", async () => {
    users.set("user-1", {
      id: "user-1",
      email: "patient@example.com",
      name: "Patient Local",
      role: "patient",
      googleId: null,
      avatarUrl: null,
      passwordHash: "hash",
    });

    const result = await signInWithGoogleProfile(profile);
    expect(result).toMatchObject({ ok: true, outcome: "linked", user: { id: "user-1", name: "Asha Rao", email: "patient@example.com" } });
    expect(users.get("user-1")).toMatchObject({ googleId: "google-sub-1", name: "Asha Rao", avatarUrl: "https://img.example/a.png", passwordHash: "hash" });
    expect(users.size).toBe(1);
  });

  it("signs in by Google id on later visits and refreshes the saved name, Gmail address and photo", async () => {
    await signInWithGoogleProfile(profile);
    const again = await signInWithGoogleProfile({ ...profile, email: "renamed@example.com", name: "Asha R. Rao", picture: "https://img.example/b.png" });
    expect(again).toMatchObject({ ok: true, outcome: "existing", user: { name: "Asha R. Rao", email: "renamed@example.com" } });
    expect(users.size).toBe(1);
    expect([...users.values()][0]).toMatchObject({ name: "Asha R. Rao", email: "renamed@example.com", avatarUrl: "https://img.example/b.png" });
  });

  it("keeps the old address when the new Gmail address already belongs to another account", async () => {
    await signInWithGoogleProfile(profile);
    users.set("user-9", { id: "user-9", email: "taken@example.com", name: "Other", role: "patient", googleId: "other-sub", avatarUrl: null, passwordHash: null });
    const again = await signInWithGoogleProfile({ ...profile, email: "taken@example.com" });
    expect(again).toMatchObject({ ok: true, outcome: "existing", user: { email: "patient@example.com" } });
  });

  it("does not follow an unverified email change", async () => {
    await signInWithGoogleProfile(profile);
    const again = await signInWithGoogleProfile({ ...profile, email: "new@example.com", emailVerified: false });
    expect(again).toMatchObject({ ok: true, outcome: "existing", user: { email: "patient@example.com" } });
  });

  it("has no password: a Google-created account stores no hash", async () => {
    await signInWithGoogleProfile(profile);
    expect([...users.values()][0].passwordHash).toBeNull();
  });

  it("refuses to link or create from an unverified Google email", async () => {
    users.set("user-1", {
      id: "user-1",
      email: "patient@example.com",
      name: "Patient Local",
      role: "patient",
      googleId: null,
      avatarUrl: null,
      passwordHash: "hash",
    });
    await expect(signInWithGoogleProfile({ ...profile, emailVerified: false })).resolves.toEqual({
      ok: false,
      reason: "unverified_email",
    });
    expect(users.get("user-1")?.googleId).toBeNull();
  });

  it("refuses when the email belongs to a different Google account", async () => {
    users.set("user-1", {
      id: "user-1",
      email: "patient@example.com",
      name: "Patient Local",
      role: "patient",
      googleId: "someone-else",
      avatarUrl: null,
      passwordHash: null,
    });
    await expect(signInWithGoogleProfile(profile)).resolves.toEqual({ ok: false, reason: "account_conflict" });
  });
});
