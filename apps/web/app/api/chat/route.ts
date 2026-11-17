import { streamText } from "ai";
import { z } from "zod";
import { chatProvider, CHAT_MODEL } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  buildSystemPrompt,
  CHAT_LIMITS,
  RATE_LIMIT_REPLY,
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

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** User messages sent today, blocked ones included, across every conversation. */
async function messagesUsedToday(patientId: string) {
  return prisma.chatMessage.count({
    where: { patientId, role: "user", createdAt: { gte: startOfUtcDay() } },
  });
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

  const [rows, used] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { patientId: user.id, clinicalReportId: reportId, clearedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, role: true, content: true, guard: true, createdAt: true },
    }),
    messagesUsedToday(user.id),
  ]);

  return json({
    messages: rows,
    remaining: Math.max(0, CHAT_LIMITS.dailyMessages - used),
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

  const used = await messagesUsedToday(user.id);
  if (used >= CHAT_LIMITS.dailyMessages) {
    return json({ error: RATE_LIMIT_REPLY, guard: "rate_limit" satisfies ChatGuard, remaining: 0 }, 429);
  }
  const remaining = String(Math.max(0, CHAT_LIMITS.dailyMessages - used - 1));
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

/** Clear chat: hides the conversation. Rows are kept so the daily limit still counts them. */
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
