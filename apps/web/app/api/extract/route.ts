import { extractClinicalDiagnosis } from "@/lib/ai/extractor";
import { getCurrentUser } from "@/lib/auth/session";

interface ExtractRequest {
  reportText?: unknown;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ExtractRequest;
  try {
    body = (await request.json()) as ExtractRequest;
  } catch {
    return Response.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  if (typeof body.reportText !== "string" || !body.reportText.trim()) {
    return Response.json({ error: "reportText is required" }, { status: 400 });
  }

  try {
    const diagnosis = await extractClinicalDiagnosis(body.reportText);
    return Response.json(diagnosis);
  } catch (error) {
    console.error("Clinical diagnosis extraction failed", error);
    return Response.json(
      { error: "The clinical report could not be safely parsed" },
      { status: 500 },
    );
  }
}
