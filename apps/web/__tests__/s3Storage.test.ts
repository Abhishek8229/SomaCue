// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({
  send: vi.fn(),
  presign: vi.fn(),
  regions: [] as string[],
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: { region: string }) {
      aws.regions.push(config.region);
    }
    send = aws.send;
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return { S3Client, PutObjectCommand, GetObjectCommand };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: aws.presign }));

import { storeUpload } from "@/lib/intake/storage";
import { DOWNLOAD_URL_TTL_SECONDS, formatS3Url, isUploadKey, parseUploadUrl, presignDownload, putUpload, readUpload } from "@/lib/storage/s3";

const UUID = "279a4232-b42d-47c3-b15f-c9d658848d8d";
const KEY = `uploads/${UUID}.pdf`;

beforeEach(() => {
  aws.send.mockReset();
  aws.presign.mockReset();
  vi.stubEnv("UPLOADS_BUCKET", "somacue-uploads-test");
  vi.stubEnv("AWS_REGION", "ap-southeast-2");
});
afterEach(() => vi.unstubAllEnvs());

describe("upload keys and references", () => {
  it("accepts only uploads/<uuid>.<ext>", () => {
    expect(isUploadKey(KEY)).toBe(true);
    expect(isUploadKey(`uploads/${UUID}`)).toBe(true);
    for (const bad of [`uploads/../${UUID}.pdf`, `other/${UUID}.pdf`, "uploads/a.pdf", `uploads/${UUID}.pdf/x`, `uploads/${UUID}.`]) {
      expect(isUploadKey(bad)).toBe(false);
    }
  });

  it("round-trips a reference and rejects another bucket", () => {
    const url = formatS3Url("somacue-uploads-test", KEY);
    expect(url).toBe(`s3://somacue-uploads-test/${KEY}`);
    expect(parseUploadUrl(url)).toEqual({ bucket: "somacue-uploads-test", key: KEY });
    expect(parseUploadUrl(`s3://elsewhere/${KEY}`)).toBeNull();
    expect(parseUploadUrl("https://somacue-uploads-test.s3.amazonaws.com/" + KEY)).toBeNull();
  });

  it("trusts nothing when no bucket is configured", () => {
    vi.stubEnv("UPLOADS_BUCKET", "");
    expect(parseUploadUrl(`s3://somacue-uploads-test/${KEY}`)).toBeNull();
  });
});

describe("putUpload, readUpload, presignDownload", () => {
  it("writes with server-side encryption and returns the reference", async () => {
    aws.send.mockResolvedValue({});
    const url = await putUpload(KEY, Buffer.from("x"), "application/pdf");
    expect(url).toBe(`s3://somacue-uploads-test/${KEY}`);
    const command = aws.send.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({ Bucket: "somacue-uploads-test", Key: KEY, ContentType: "application/pdf", ServerSideEncryption: "AES256" });
    expect(aws.regions).toContain("ap-southeast-2");
  });

  it("refuses keys outside uploads/ and a missing bucket", async () => {
    await expect(putUpload("secrets/a.pdf", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid upload key/);
    await expect(readUpload("secrets/a.pdf")).rejects.toThrow(/Invalid upload key/);
    await expect(presignDownload("secrets/a.pdf", "a.pdf")).rejects.toThrow(/Invalid upload key/);
    vi.stubEnv("UPLOADS_BUCKET", "");
    await expect(putUpload(KEY, Buffer.from("x"), "text/plain")).rejects.toThrow(/not configured/);
  });

  it("reads an object into a buffer", async () => {
    aws.send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) }, ContentType: "application/pdf" });
    const result = await readUpload(KEY);
    expect([...result.data]).toEqual([1, 2, 3]);
    expect(result.contentType).toBe("application/pdf");
  });

  it("signs a five-minute link with a safe download name", async () => {
    aws.presign.mockResolvedValue("https://signed.example/object");
    const url = await presignDownload(KEY, 'a"b\r\nc.pdf');
    expect(url).toBe("https://signed.example/object");
    const [, command, options] = aws.presign.mock.calls[0] as [unknown, { input: Record<string, string> }, { expiresIn: number }];
    expect(options.expiresIn).toBe(DOWNLOAD_URL_TTL_SECONDS);
    expect(DOWNLOAD_URL_TTL_SECONDS).toBe(300);
    expect(command.input.ResponseContentDisposition).toBe('inline; filename="a_b__c.pdf"');
  });
});

describe("storeUpload", () => {
  const file = (name = "scan.PDF", type = "application/pdf") => new File([new Uint8Array([1, 2, 3])], name, { type });

  it("stores a file in S3 under a random key and keeps the extension", async () => {
    aws.send.mockResolvedValue({});
    const stored = await storeUpload(file());
    expect(stored.storage).toBe("s3");
    expect(stored.url).toMatch(/^s3:\/\/somacue-uploads-test\/uploads\/[0-9a-f-]{36}\.pdf$/);
    expect(parseUploadUrl(stored.url)).not.toBeNull();
  });

  it("hides storage errors from the caller", async () => {
    aws.send.mockRejectedValue(new Error("AccessDenied: arn:aws:s3:::secret-bucket"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(storeUpload(file())).rejects.toThrow("The file could not be saved.");
  });

  it("rejects an empty file", async () => {
    await expect(storeUpload(new File([], "a.pdf"))).rejects.toThrow(/non-empty/);
  });

  it("refuses to fall back to local disk in production", async () => {
    vi.stubEnv("UPLOADS_BUCKET", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(storeUpload(file())).rejects.toThrow("File storage is not configured.");
    expect(aws.send).not.toHaveBeenCalled();
  });
});
