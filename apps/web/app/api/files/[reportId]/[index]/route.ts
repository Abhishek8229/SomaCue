import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { orderedReportFiles } from "@/lib/intake/reportFiles";
import { parseUploadUrl, presignDownload } from "@/lib/storage/s3";

type Context = { params: Promise<{ reportId: string; index: string }> };

const json = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Opens one of the signed-in patient's own uploaded files. Answers with a redirect to a pre-signed S3 link that
 * expires in five minutes; the bucket itself is private. 401 when signed out, 404 for anything that is not the
 * caller's own file (a report that is someone else's looks the same as one that does not exist).
 */
export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return json("Sign in to open this file.", 401);

  const { reportId, index } = await params;
  if (!/^\d{1,3}$/.test(index) || reportId.length === 0 || reportId.length > 64) return json("File not found.", 404);

  const report = await prisma.clinicalReport.findFirst({
    where: { id: reportId, patientId: user.id },
    select: { fileUrls: true, scanUrls: true, prescriptionUrls: true },
  });
  if (!report) return json("File not found.", 404);

  const reference = orderedReportFiles(report)[Number(index)];
  const stored = reference ? parseUploadUrl(reference) : null;
  if (!stored) return json("File not found.", 404);

  try {
    const url = await presignDownload(stored.key, stored.key.slice("uploads/".length));
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[SomaCue files] Could not sign a download link.", error instanceof Error ? error.message : error);
    return json("The file could not be opened. Try again.", 500);
  }
}
