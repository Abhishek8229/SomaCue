import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { storeUpload } from "@/lib/intake/storage";
import { validateUploadFile } from "@/lib/intake/uploadGuard";

/** Stores one intake file. Signed-in patients only; images and PDFs up to the size limit. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Send the file as multipart form data." }, { status: 400 });
  }

  const file = formData.get("scanFile");
  const check = validateUploadFile(file);
  if (!check.ok) {
    return NextResponse.json({ success: false, error: check.error }, { status: check.status });
  }

  try {
    const stored = await storeUpload(file as File);
    return NextResponse.json({ success: true, ...stored });
  } catch (error) {
    console.error("[SomaCue upload] Storing the file failed.", error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: "The file could not be saved. Try again." }, { status: 500 });
  }
}
