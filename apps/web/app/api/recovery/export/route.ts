import { getCurrentUser } from "@/lib/auth/session";
import { parseTzOffset, renderRecoveryReport, reportFileName } from "@/lib/recovery/export";
import { getRecoveryTimeline } from "@/lib/recovery/server";

/**
 * The patient's Recovery Timeline as a printable, shareable HTML document. Anytime, for the signed-in
 * patient's own record only. `?download=1` saves it as a file; otherwise it opens in the browser.
 * `?tz=` is the browser's time zone offset (as `getTimezoneOffset`), so dates read as the patient's own days.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "Please sign in to export your Recovery Timeline." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const url = new URL(request.url);
  const tzOffsetMinutes = parseTzOffset(url.searchParams.get("tz"));
  const timeline = await getRecoveryTimeline(user);
  const html = renderRecoveryReport(timeline, { tzOffsetMinutes });

  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // The report has no scripts and loads nothing, and the browser is told to keep it that way.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
  };
  if (url.searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="${reportFileName(user.name, timeline.generatedAt, tzOffsetMinutes)}"`;
  }
  return new Response(html, { headers });
}
