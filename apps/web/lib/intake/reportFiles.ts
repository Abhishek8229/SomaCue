/** Shared rules for the two intake upload categories. */

export type ReportCategory = "scan" | "prescription";

export type ReportFiles = {
  /** MRIs, X-rays, CT scans and other diagnostic imaging. */
  scans: string[];
  /** Prescriptions and notes from a doctor, physiotherapist or other clinician. */
  prescriptions: string[];
  /** Files from reports created before uploads were categorized. */
  uncategorized: string[];
};

export const MAX_FILES_PER_CATEGORY = 10;

export const AI_DISCLAIMER_TEXT =
  "I understand that AI analysis without a physical medical evaluation or a doctor's prescription may not be completely accurate.";

import { parseUploadUrl } from "@/lib/storage/s3";

const LOCAL_UPLOAD = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/i;

/**
 * Only references produced by our own upload action are accepted: a file in the configured S3 bucket
 * (`s3://<bucket>/uploads/<uuid>.<ext>`), or, outside production, a file in /public/uploads. This keeps the AI file
 * loader from reading arbitrary buckets, hosts or local paths.
 */
export function isTrustedUploadUrl(value: string) {
  if (parseUploadUrl(value)) return true;
  return process.env.NODE_ENV !== "production" && LOCAL_UPLOAD.test(value);
}

/**
 * Every file of a report in one stable order: scans, then prescriptions, then files from before uploads were
 * categorized. The download route and the dashboard both address a file by its position in this list.
 */
export function orderedReportFiles(record: {
  fileUrls: string[];
  scanUrls?: string[] | null;
  prescriptionUrls?: string[] | null;
}): string[] {
  const files = reportFilesFromRecord(record);
  return [...files.scans, ...files.prescriptions, ...files.uncategorized];
}
export function reportFilesFromRecord(record: {
  fileUrls: string[];
  scanUrls?: string[] | null;
  prescriptionUrls?: string[] | null;
}): ReportFiles {
  const scans = record.scanUrls ?? [];
  const prescriptions = record.prescriptionUrls ?? [];
  const categorized = new Set([...scans, ...prescriptions]);

  return {
    scans,
    prescriptions,
    uncategorized: record.fileUrls.filter((url) => !categorized.has(url)),
  };
}
