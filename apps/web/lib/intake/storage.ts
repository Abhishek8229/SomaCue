import { BlobServiceClient } from "@azure/storage-blob";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

async function saveLocalUpload(file: File) {
  const uploadsDirectory = join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDirectory, { recursive: true });

  const extension = extname(file.name).replace(/[^a-zA-Z0-9.]/g, "");
  const fileName = `${randomUUID()}${extension}`;
  await writeFile(join(uploadsDirectory, fileName), Buffer.from(await file.arrayBuffer()));

  return `/uploads/${fileName}`;
}

/** Stores a patient upload in Azure Blob storage, or under public/uploads when Azure is not configured. */
export async function storeUpload(file: File) {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("A non-empty file is required.");
  }

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
  if (!connectionString) {
    console.warn("[SomaCue upload] Azure storage is not configured; using local upload fallback.");
    return { url: await saveLocalUpload(file), storage: "local" as const };
  }

  try {
    const extension = extname(file.name).replace(/[^a-zA-Z0-9.]/g, "");
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient("patient-scans");
    const blockBlobClient = containerClient.getBlockBlobClient(`${randomUUID()}${extension}`);

    await blockBlobClient.uploadData(Buffer.from(await file.arrayBuffer()));
    return { url: blockBlobClient.url, storage: "azure" as const };
  } catch (error) {
    const details =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };
    console.error("[SomaCue upload] Azure Blob upload failed.", {
      fileName: file.name,
      fileSize: file.size,
      ...details,
    });

    if (process.env.ALLOW_LOCAL_UPLOAD_FALLBACK !== "false") {
      console.warn("[SomaCue upload] Using local upload fallback after Azure failure.");
      return { url: await saveLocalUpload(file), storage: "local" as const };
    }

    throw new Error(`Azure upload failed: ${details.message}`);
  }
}
