// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: db.query } }));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  db.query.mockReset();
});

describe("GET /api/health", () => {
  it("answers 200 with no data when the database responds", async () => {
    db.query.mockResolvedValue([{ "?column?": 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 503, without the error, when the database is down", async () => {
    db.query.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432 password=secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toBe('{"ok":false}');
  });
});
