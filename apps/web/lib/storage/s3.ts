import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/*
 * The only module that talks to S3. Patient files live in one private bucket (UPLOADS_BUCKET) under `uploads/`.
 * A stored file is referenced as `s3://<bucket>/uploads/<uuid>.<ext>`. The browser never gets a public URL: the
 * authenticated /api/files route hands out a short-lived pre-signed one.
 *
 * Credentials come from the default provider chain (the EC2 instance role in production), never from env keys.
 */

export const UPLOAD_PREFIX = "uploads/";
export const DOWNLOAD_URL_TTL_SECONDS = 300;
export const DEFAULT_REGION = "ap-southeast-2";

const KEY_PATTERN = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/i;
const S3_URL_PATTERN = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/(.+)$/;

let cached: { region: string; client: S3Client } | null = null;

function client(): S3Client {
  const region = process.env.AWS_REGION?.trim() || DEFAULT_REGION;
  if (!cached || cached.region !== region) cached = { region, client: new S3Client({ region }) };
  return cached.client;
}

/** The configured uploads bucket, or null when file storage is not set up. */
export function uploadsBucket(): string | null {
  return process.env.UPLOADS_BUCKET?.trim() || null;
}

export function isUploadKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export function formatS3Url(bucket: string, key: string): string {
  return `s3://${bucket}/${key}`;
}

/**
 * The key of one of our own stored files, or null. Only the configured bucket and the strict `uploads/<uuid>.<ext>`
 * shape pass, so a stored reference can never point the server at another bucket or path.
 */
export function parseUploadUrl(value: string): { bucket: string; key: string } | null {
  const bucket = uploadsBucket();
  if (!bucket) return null;
  const match = S3_URL_PATTERN.exec(value);
  if (!match || match[1] !== bucket || !isUploadKey(match[2])) return null;
  return { bucket, key: match[2] };
}

export async function putUpload(key: string, body: Buffer, contentType: string): Promise<string> {
  const bucket = uploadsBucket();
  if (!bucket) throw new Error("File storage is not configured.");
  if (!isUploadKey(key)) throw new Error("Invalid upload key.");
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      ServerSideEncryption: "AES256",
    }),
  );
  return formatS3Url(bucket, key);
}

export async function readUpload(key: string, abortSignal?: AbortSignal): Promise<{ data: Buffer; contentType?: string }> {
  const bucket = uploadsBucket();
  if (!bucket) throw new Error("File storage is not configured.");
  if (!isUploadKey(key)) throw new Error("Invalid upload key.");
  const response = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal });
  if (!response.Body) throw new Error("The stored file is empty.");
  return { data: Buffer.from(await response.Body.transformToByteArray()), contentType: response.ContentType };
}

/** A pre-signed GET URL that expires in five minutes. `fileName` is offered to the browser as the download name. */
export async function presignDownload(key: string, fileName: string): Promise<string> {
  const bucket = uploadsBucket();
  if (!bucket) throw new Error("File storage is not configured.");
  if (!isUploadKey(key)) throw new Error("Invalid upload key.");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `inline; filename="${safeName}"`,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
  );
}
