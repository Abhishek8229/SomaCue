import { streamText } from "ai";
import { z } from "zod";
import { AiConfigError, chatMaxOutputTokens, getChatModel } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/auth/session";
import { getCompanionAllowance, getUserPlan, proRequiredResponse } from "@/lib/billing/entitlements";
import { messagesLeft, proRequired, type CompanionUsage } from "@/lib/billing/plans";
import {
  buildSystemPrompt,
  CHAT_LIMITS,
  companionLimitReply,
  screenChatMessage,
  trimHistory,
  type ChatGuard,
} from "@/lib/clinical/chatGuardrails";
import { loadChatContext } from "@/lib/clinical/server-chat";
import { recordChatInsight } from "@/lib/recovery/server";
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

/** The counter, as response headers: the chat panel reads these after every message. */
function usageHeaders(usage: CompanionUsage): Record<string, string> {
  return {
    "X-Chat-Remaining": String(messagesLeft(usage)),
    ...(usage.dailyLeft === null ? {} : { "X-Chat-Daily-Left": String(usage.dailyLeft) }),
    ...(usage.weeklyLeft === null ? {} : { "X-Chat-Weekly-Left": String(usage.weeklyLeft) }),
    ...(usage.totalLeft === null ? {} : { "X-Chat-Total-Left": String(usage.totalLeft) }),
    ...(usage.nextSlotAt ? { "X-Chat-Next-Slot": usage.nextSlotAt } : {}),
    ...(usage.windowEndsAt ? { "X-Chat-Window-Ends": usage.windowEndsAt } : {}),
  };
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
  const [rows, check] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { patientId: user.id, clinicalReportId: reportId, clearedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, role: true, content: true, guard: true, createdAt: true },
    }),
    getCompanionAllowance(user.id, plan),
  ]);

  return json({
    messages: rows,
    plan,
    // Messages left right now: today's, and on Free also what is left of the 10. `usage` has the detail.
    remaining: messagesLeft(check.usage),
    usage: check.usage,
    // Why the next message would be refused, or null: "daily", "weekly", "total" or "window_ended".
    limit: check.verdict.allowed ? null : check.verdict.reason,
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

  // Free: 3 messages in any rolling 24 hours, 10 in total, only during the 7 days after the plan was
  // made. Pro: a fair-use limit of 50 messages in any rolling 7 days. The counts come from stored messages, so reloading or clearing the
  // chat resets nothing. A warning-sign (red flag) reply is a safety message that costs nothing,
  // so it is never held back by any limit.
  const plan = await getUserPlan(user.id);
  const check = await getCompanionAllowance(user.id, plan);
  const isSafetyReply = screen.action === "guard" && screen.guard === "red_flag";
  if (!check.verdict.allowed && !isSafetyReply) {
    const { verdict } = check;
    if (verdict.reason === "daily" || verdict.reason === "weekly") {
      return json(
        {
          error: companionLimitReply(verdict),
          guard: "rate_limit" satisfies ChatGuard,
          reason: verdict.reason,
          retryAt: verdict.retryAt.toISOString(),
          remaining: 0,
          usage: check.usage,
        },
        429,
        { "Retry-After": String(verdict.retryAfterSeconds), ...usageHeaders(check.usage), "X-Chat-Remaining": "0" },
      );
    }
    // Free: all 10 used, or the 7-day window is over. Only Pro lifts that.
    return proRequiredResponse(proRequired("companion"), { ...usageHeaders(check.usage), "X-Chat-Remaining": "0", "X-Chat-Block": verdict.reason });
  }
  const usageAfter = usageHeaders(check.after);
  const text = screen.action === "allow" ? screen.text : body.data.message.replace(/\s+/g, " ").trim();
  const conversation = { patientId: user.id, clinicalReportId: reportId };

  // Guarded messages are answered here, without any AI call.
  if (screen.action === "guard") {
    const userMessageId = crypto.randomUUID();
    await prisma.chatMessage.createMany({
      data: [
        { id: userMessageId, ...conversation, role: "user", content: text },
        { ...conversation, role: "assistant", content: screen.reply, guard: screen.guard },
      ],
    });
    // A warning-sign message is clinically important, so it goes on the Recovery Timeline. Off-topic and blocked ones do not.
    if (screen.guard === "red_flag") {
      await recordChatInsight(user.id, { id: userMessageId, reportId, content: text, createdAt: new Date() }, { redFlag: true });
    }
    return new Response(screen.reply, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Chat-Guard": screen.guard,
        ...usageAfter,
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

  // Read the AI settings before saving anything, so a misconfigured server neither stores the
  // message nor counts it against the limits. Guarded replies above never need the AI.
  let chatModel: ReturnType<typeof getChatModel>;
  try {
    chatModel = getChatModel();
  } catch (error) {
    if (error instanceof AiConfigError) {
      console.error(`[SomaCue chat] ${error.message}`);
      return json({ error: "The Rehab Companion is not available right now. Please try again later." }, 503);
    }
    throw error;
  }

  const userMessage = await prisma.chatMessage.create({ data: { ...conversation, role: "user", content: text } });
  // Symptoms, triggers, movement trouble or progress the patient describes go on the Recovery Timeline.
  // Plain rules on the message already sent: no extra AI call, so no extra tokens or delay.
  await recordChatInsight(user.id, { id: userMessage.id, reportId, content: text, createdAt: userMessage.createdAt });

  const previous = trimHistory(
    history
      .reverse()
      .filter((row): row is typeof row & { role: "user" | "assistant" } => row.role === "user" || row.role === "assistant"),
    CHAT_LIMITS.historyMessages,
  );

  let providerError: unknown = null;
  const result = streamText({
    model: chatModel,
    system: buildSystemPrompt(context),
    messages: [...previous, { role: "user", content: text }],
    // 350 for most providers; 1200 on Gemini, whose thinking tokens count against this limit.
    maxOutputTokens: chatMaxOutputTokens(CHAT_LIMITS.maxOutputTokens),
    temperature: 0.3,
    // Two retries ride out a provider's brief "high demand" (503) errors; the first answer is awaited below anyway.
    maxRetries: 2,
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
      providerError = error;
      console.error("[SomaCue chat] AI reply failed.", {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  // Wait for the first piece of the answer before replying. If the provider failed (over its quota, busy, a bad key)
  // or answered with nothing, say so with a 503 instead of an empty 200 that looks like a broken chat. Nothing was
  // answered, so the saved message is removed and does not count against the patient's limits.
  const pieces = result.textStream[Symbol.asyncIterator]();
  let first: IteratorResult<string> | null = null;
  try {
    first = await pieces.next();
  } catch (error) {
    providerError = providerError ?? error;
  }
  if (!first || first.done) {
    await prisma.chatMessage.delete({ where: { id: userMessage.id } }).catch(() => undefined);
    return json(
      {
        error: providerError
          ? "The Rehab Companion's AI service is busy or has reached its limit right now. Please try again in a little while. Your message was not counted."
          : "The Rehab Companion couldn't answer just now. Please try again. Your message was not counted.",
        reason: "provider",
      },
      503,
      usageHeaders(check.usage),
    );
  }

  const encoder = new TextEncoder();
  const answer = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      try {
        const next = await pieces.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch {
        controller.close(); // the answer so far stays; the failure is logged by onError
      }
    },
    async cancel() {
      await pieces.return?.();
    },
  });
  return new Response(answer, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...usageAfter },
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
