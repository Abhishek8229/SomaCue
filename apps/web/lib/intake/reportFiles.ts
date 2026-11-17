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

const LOCAL_UPLOAD = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,16})?$/i;

/**
 * Only URLs produced by our own upload action are accepted: a local file in
 * /public/uploads or a blob in the "patient-scans" Azure container. This
 * keeps the AI file loader from fetching arbitrary hosts or local paths.
 */
export function isTrustedUploadUrl(value: string) {
  if (LOCAL_UPLOAD.test(value)) return true;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".blob.core.windows.net") &&
      url.pathname.startsWith("/patient-scans/")
    );
  } catch {
    return false;
  }
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
