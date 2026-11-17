// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentUser, storeUpload } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  storeUpload: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/intake/storage", () => ({ storeUpload }));

import { POST } from "@/app/api/upload/route";
import { MAX_UPLOAD_BYTES, validateUploadFile } from "@/lib/intake/uploadGuard";

const pdf = (name = "scan.pdf", size = 4) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

function upload(file: File | null) {
  const form = new FormData();
  if (file) form.set("scanFile", file);
  return new Request("http://localhost:3100/api/upload", { method: "POST", body: form });
}

beforeEach(() => {
  currentUser.mockReset();
  storeUpload.mockReset();
  storeUpload.mockResolvedValue({ url: "/uploads/file.pdf", storage: "local" });
});

describe("POST /api/upload", () => {
  it("rejects a signed-out request with 401 and stores nothing", async () => {
    currentUser.mockResolvedValue(null);
    const response = await POST(upload(pdf()));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ success: false, error: "Unauthorized" });
    expect(storeUpload).not.toHaveBeenCalled();
  });

  it("stores a valid file for a signed-in patient", async () => {
    currentUser.mockResolvedValue({ id: "u1", email: "a@example.com", name: "A", role: "patient" });
    const response = await POST(upload(pdf()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, url: "/uploads/file.pdf", storage: "local" });
    expect(storeUpload).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing file, an unsupported type and an oversized file", async () => {
    currentUser.mockResolvedValue({ id: "u1", email: "a@example.com", name: "A", role: "patient" });

    expect((await POST(upload(null))).status).toBe(400);
    expect((await POST(upload(new File(["MZ"], "setup.exe", { type: "application/x-msdownload" })))).status).toBe(415);
    expect((await POST(upload(pdf("big.pdf", MAX_UPLOAD_BYTES + 1)))).status).toBe(413);
    expect(storeUpload).not.toHaveBeenCalled();
  });
});

describe("validateUploadFile", () => {
  it("accepts PDFs and common image types", () => {
    for (const [name, type] of [
      ["a.pdf", "application/pdf"],
      ["a.jpg", "image/jpeg"],
      ["a.PNG", "image/png"],
      ["a.webp", "image/webp"],
      ["a.heic", "image/heic"],
    ]) {
      expect(validateUploadFile(new File(["x"], name, { type }))).toEqual({ ok: true });
    }
  });

  it("rejects a mismatched extension even with an allowed type", () => {
    expect(validateUploadFile(new File(["x"], "script.js", { type: "application/pdf" }))).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("rejects empty and non-file values", () => {
    expect(validateUploadFile(new File([], "empty.pdf", { type: "application/pdf" }))).toMatchObject({ ok: false, status: 400 });
    expect(validateUploadFile("not a file")).toMatchObject({ ok: false, status: 400 });
  });
});
