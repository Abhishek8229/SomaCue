// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  findFirst: vi.fn(),
  presign: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { clinicalReport: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/storage/s3", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/s3")>("@/lib/storage/s3");
  return { ...actual, presignDownload: mocks.presign };
});

import { GET } from "@/app/api/files/[reportId]/[index]/route";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "aaaaaaaa-0000-4000-8000-000000000003";
const url = (id: string) => `s3://somacue-test/uploads/${id}.pdf`;

const call = (reportId: string, index: string) =>
  GET(new Request("http://localhost/api/files/x/0"), { params: Promise.resolve({ reportId, index }) });

beforeEach(() => {
  vi.stubEnv("UPLOADS_BUCKET", "somacue-test");
  mocks.user = { id: "user-1" };
  mocks.findFirst.mockReset();
  mocks.findFirst.mockResolvedValue({ fileUrls: [url(A), url(B), url(C)], scanUrls: [url(A)], prescriptionUrls: [url(B)] });
  mocks.presign.mockReset();
  mocks.presign.mockResolvedValue("https://signed.example/file?X-Amz-Signature=abc");
});

describe("GET /api/files/[reportId]/[index]", () => {
  it("returns 401 when signed out, without touching the database", async () => {
    mocks.user = null;
    expect((await call("r1", "0")).status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("only looks up a report owned by the caller", async () => {
    await call("r1", "0");
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "r1", patientId: "user-1" });
  });

  it("redirects to a signed link, with caching off", async () => {
    const response = await call("r1", "0");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://signed.example/file?X-Amz-Signature=abc");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.presign).toHaveBeenCalledWith(`uploads/${A}.pdf`, `${A}.pdf`);
  });

  it("numbers files as scans, then prescriptions, then the rest", async () => {
    await call("r1", "1");
    await call("r1", "2");
    expect(mocks.presign.mock.calls.map((args) => args[0])).toEqual([`uploads/${B}.pdf`, `uploads/${C}.pdf`]);
  });

  it("answers 404 for another user's report or an unknown one", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await call("someone-elses", "0");
    expect(response.status).toBe(404);
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it.each(["3", "-1", "1.5", "abc", "99999", ""])("answers 404 for index %j", async (index) => {
    expect((await call("r1", index)).status).toBe(404);
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("does not sign a reference that is not one of our uploads", async () => {
    mocks.findFirst.mockResolvedValue({ fileUrls: ["https://acct.blob.core.windows.net/patient-scans/a.pdf"], scanUrls: [], prescriptionUrls: [] });
    expect((await call("r1", "0")).status).toBe(404);
    mocks.findFirst.mockResolvedValue({ fileUrls: ["s3://other-bucket/uploads/" + A + ".pdf"], scanUrls: [], prescriptionUrls: [] });
    expect((await call("r1", "0")).status).toBe(404);
  });

  it("answers 500 without details when signing fails", async () => {
    mocks.presign.mockRejectedValue(new Error("AccessDenied arn:aws:iam::123:role/x"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call("r1", "0");
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("arn:aws");
  });
});
