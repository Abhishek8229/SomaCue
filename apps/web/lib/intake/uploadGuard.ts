/** What the intake accepts: scans and reports as images or PDFs. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES: readonly string[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];

export type UploadCheck = { ok: true } | { ok: false; status: 400 | 413 | 415; error: string };

export function validateUploadFile(file: unknown): UploadCheck {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, status: 400, error: "A non-empty file is required." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Files must be ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB or smaller.`,
    };
  }
  const name = file.name.toLowerCase();
  const typeOk = ALLOWED_UPLOAD_TYPES.includes(file.type);
  const extensionOk = ALLOWED_EXTENSIONS.some((extension) => name.endsWith(extension));
  if (!typeOk || !extensionOk) {
    return { ok: false, status: 415, error: "Upload an image (JPG, PNG, WebP, GIF, HEIC) or a PDF." };
  }
  return { ok: true };
}
