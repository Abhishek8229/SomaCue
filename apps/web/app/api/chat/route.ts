import { streamText } from "ai";
import { z } from "zod";
import { chatProvider, CHAT_MODEL } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth/session";
import { checkProCompanionLimits, countCompanionMessages, getUserPlan, proRequiredResponse } from "@/lib/billing/entitlements";
import { canSendCompanionMessage, PLAN_LIMITS, proRequired } from "@/lib/billing/plans";
import {
  buildSystemPrompt,
  CHAT_LIMITS,
  companionLimitReply,
  screenChatMessage,
  trimHistory,
  type ChatGuard,
} from "@/lib/clinical/chatGuardrails";
import { loadChatContext } from "@/lib/clinical/server-chat";
import { prisma } from "@/lib/db/prisma";

const CHAT_TIMEOUT_MS = 45_000;

const reportIdSchema = z.string().min(1).max(64).nullable();
const postSchema = z.object({
  reportId: reportIdSchema,
  // The real limit is checked after whitespace is collapsed; this only stops huge bodies.
  message: z.string().max(CHAT_LIMITS.maxMessageChars * 4),
});
const deleteSchema = z.object({ reportId: reportIdSchema });

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}


/** The report must belong to the user; null means the pre-intake conversation. */
async function ownsReport(patientId: string, reportId: string | null) {
  if (reportId === null) return true;
  const report = await prisma.clinicalReport.findFirst({
    where: { id: reportId, patientId },
    select: { id: true },
  });
  return report !== null;
}

async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Please sign in to use the Rehab Companion." }, 401);

  const parsed = reportIdSchema.safeParse(new URL(request.url).searchParams.get("reportId") || null);
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  const reportId = parsed.data;
  if (!(await ownsReport(user.id, reportId))) return json({ error: "Conversation not found." }, 404);

  const plan = await getUserPlan(user.id);
  const [rows, proLimit, sentTotal] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { patientId: user.id, clinicalReportId: reportId, clearedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, role: true, content: true, guard: true, createdAt: true },
    }),
    plan === "pro" ? checkProCompanionLimits(user.id) : Promise.resolve(null),
    plan === "free" ? countCompanionMessages(user.id) : Promise.resolve(0),
  ]);

  return json({
    messages: rows,
    plan,
    // Free: what is left of the 3. Pro: what fits before a fair-use pause; null while paused,
    // so the box stays usable and the next message gets the pause explanation.
    remaining: plan === "free" ? Math.max(0, PLAN_LIMITS.free.companionMessages - sentTotal) : proLimit?.allowed ? proLimit.remaining : null,
    maxChars: CHAT_LIMITS.maxMessageChars,
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Please sign in to use the Rehab Companion." }, 401);

  const body = postSchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid request." }, 400);
  const { reportId } = body.data;

  const screen = screenChatMessage(body.data.message);
  if (screen.action === "reject") return json({ error: screen.message }, 400);

  if (!(await ownsReport(user.id, reportId))) return json({ error: "Conversation not found." }, 404);

  // Free allows three messages in total. A warning-sign (red flag) reply is a safety
  // message that costs nothing, so it is never held back by the plan.
  const plan = await getUserPlan(user.id);
  const sentTotal = plan === "free" ? await countCompanionMessages(user.id) : 0;
  const isSafetyReply = screen.action === "guard" && screen.guard === "red_flag";
  if (plan === "free" && !isSafetyReply && !canSendCompanionMessage(plan, sentTotal)) {
    return proRequiredResponse(proRequired("companion"), { "X-Chat-Remaining": "0" });
  }

  // Pro has no plan limit, only rolling fair use: 25 messages sent continuously, 30 in 24 hours.
  // The times come from the stored messages, so reloading or clearing the chat does not reset them.
  let remainingAfter: number;
  if (plan === "free") {
    remainingAfter = Math.max(0, PLAN_LIMITS.free.companionMessages - sentTotal - 1);
  } else {
    const limit = await checkProCompanionLimits(user.id);
    if (!limit.allowed) {
      return json(
        {
          error: companionLimitReply(limit),
          guard: "rate_limit" satisfies ChatGuard,
          reason: limit.reason,
          retryAt: limit.retryAt.toISOString(),
          remaining: 0,
        },
        429,
        { "Retry-After": String(limit.retryAfterSeconds), "X-Chat-Remaining": "0" },
      );
    }
    remainingAfter = Math.max(0, limit.remaining - 1);
  }
  const remaining = String(remainingAfter);
  const text = screen.action === "allow" ? screen.text : body.data.message.replace(/\s+/g, " ").trim();
  const conversation = { patientId: user.id, clinicalReportId: reportId };

  // Guarded messages are answered here, without any AI call.
  if (screen.action === "guard") {
    await prisma.chatMessage.createMany({
      data: [
        { ...conversation, role: "user", content: text },
        { ...conversation, role: "assistant", content: screen.reply, guard: screen.guard },
      ],
    });
    return new Response(screen.reply, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Chat-Guard": screen.guard,
        "X-Chat-Remaining": remaining,
      },
    });
  }

  const [context, history] = await Promise.all([
    loadChatContext(user.id, user.name, reportId),
    prisma.chatMessage.findMany({
      where: { ...conversation, clearedAt: null },
      orderBy: { createdAt: "desc" },
      take: CHAT_LIMITS.historyMessages * 2,
      select: { role: true, content: true, guard: true },
    }),
  ]);
  if (!context) return json({ error: "Conversation not found." }, 404);

  await prisma.chatMessage.create({ data: { ...conversation, role: "user", content: text } });

  const previous = trimHistory(
    history
      .reverse()
      .filter((row): row is typeof row & { role: "user" | "assistant" } => row.role === "user" || row.role === "assistant"),
    CHAT_LIMITS.historyMessages,
  );

  const result = streamText({
    model: chatProvider.chat(CHAT_MODEL),
    system: buildSystemPrompt(context),
    messages: [...previous, { role: "user", content: text }],
    maxOutputTokens: CHAT_LIMITS.maxOutputTokens,
    temperature: 0.3,
    maxRetries: 0,
    abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(CHAT_TIMEOUT_MS)]),
    onFinish: async ({ text: reply, finishReason, usage }) => {
      const content = reply.trim();
      if (!content) {
        console.warn("[SomaCue chat] AI reply was empty.", { finishReason, outputTokens: usage?.outputTokens });
        return;
      }
      await prisma.chatMessage.create({ data: { ...conversation, role: "assistant", content } });
    },
    onError: ({ error }) => {
      console.error("[SomaCue chat] AI reply failed.", {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return result.toTextStreamResponse({
    headers: { "Cache-Control": "no-store", "X-Chat-Remaining": remaining },
  });
}

/** Clear chat: hides the conversation. Rows are kept so the message limits still count them. */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Please sign in to use the Rehab Companion." }, 401);

  const body = deleteSchema.safeParse(await readJson(request));
  if (!body.success) return json({ error: "Invalid request." }, 400);
  if (!(await ownsReport(user.id, body.data.reportId))) return json({ error: "Conversation not found." }, 404);

  await prisma.chatMessage.updateMany({
    where: { patientId: user.id, clinicalReportId: body.data.reportId, clearedAt: null },
    data: { clearedAt: new Date() },
  });
  return json({ success: true });
}
