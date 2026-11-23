import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { UPLOAD_PREFIX, putUpload, uploadsBucket } from "@/lib/storage/s3";

async function saveLocalUpload(file: File) {
  const uploadsDirectory = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDirectory, { recursive: true });

  const extension = extname(file.name).replace(/[^a-zA-Z0-9.]/g, "");
  const fileName = `${randomUUID()}${extension}`;
  await writeFile(join(uploadsDirectory, fileName), Buffer.from(await file.arrayBuffer()));

  return `/uploads/${fileName}`;
}

/**
 * Stores a patient upload in the private S3 bucket (UPLOADS_BUCKET). Without a bucket, development and tests write
 * to public/uploads; production refuses, so a missing setting can never put patient files on the web server's disk.
 */
export async function storeUpload(file: File) {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A non-empty file is required.");
  }

  if (!uploadsBucket()) {
    if (process.env.NODE_ENV === "production") {
      console.error("[SomaCue upload] UPLOADS_BUCKET is not set.");
      throw new Error("File storage is not configured.");
    }
    console.warn("[SomaCue upload] UPLOADS_BUCKET is not set; using the local development folder.");
    return { url: await saveLocalUpload(file), storage: "local" as const };
  }

  try {
    const extension = extname(file.name).replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 16);
    const key = `${UPLOAD_PREFIX}${randomUUID()}${extension ? `.${extension}` : ""}`;
    const url = await putUpload(key, Buffer.from(await file.arrayBuffer()), file.type);
    return { url, storage: "s3" as const };
  } catch (error) {
    console.error("[SomaCue upload] S3 upload failed.", {
      fileSize: file.size,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new Error("The file could not be saved.");
  }
}
