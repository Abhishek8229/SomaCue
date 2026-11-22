"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MessageCircle, Send, Trash2, X } from "lucide-react";
import type { CompanionUsage } from "@/lib/billing/plans";

const MAX_CHARS = 500;

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  guard?: string | null;
  /** assistant reply still streaming */
  streaming?: boolean;
};

type Props = {
  /** Active report; each intake has its own conversation. null before the first intake. */
  reportId: string | null;
  quickPrompts: string[];
  /** Opens the upgrade offer when a Free user has used all 10 messages or the 7-day window is over. */
  onUpgrade?: () => void;
};

/**
 * Why the next message would be refused: Free's 3 for today are used, Pro's fair-use 50 for the
 * week are used, or (Free) all 10 are used or the 7 days are over.
 */
type LimitReason = "daily" | "weekly" | "total" | "window_ended";

function isUsage(value: unknown): value is CompanionUsage {
  const usage = value as Partial<CompanionUsage> | null;
  return !!usage && typeof usage === "object" && "totalLimit" in usage && "nextSlotAt" in usage;
}

function isLimit(value: unknown): value is LimitReason {
  return value === "daily" || value === "weekly" || value === "total" || value === "window_ended";
}

/** The counter after a message, from the headers the server sends with every answer. */
function usageFromHeaders(headers: Headers, previous: CompanionUsage | null): CompanionUsage | null {
  const daily = headers.get("X-Chat-Daily-Left");
  const weekly = headers.get("X-Chat-Weekly-Left");
  if ((daily === null && weekly === null) || !previous) return previous;
  const total = headers.get("X-Chat-Total-Left");
  return {
    ...previous,
    dailyLeft: daily === null ? previous.dailyLeft : Number(daily),
    weeklyLeft: weekly === null ? previous.weeklyLeft : Number(weekly),
    nextSlotAt: headers.get("X-Chat-Next-Slot"),
    totalLeft: total === null ? previous.totalLeft : Number(total),
    windowEndsAt: headers.get("X-Chat-Window-Ends") ?? previous.windowEndsAt,
  };
}

/** A slot time: just the time for today's limit, with the day and date for the weekly one. */
const timeOf = (iso: string, withDate: boolean) =>
  new Date(iso).toLocaleString(
    [],
    withDate ? { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" } : { hour: "numeric", minute: "2-digit" },
  );

let localId = 0;
const nextId = () => `local-${(localId += 1)}`;

/** Bold (**text**) and simple "- " / "1." lists, rendered without raw HTML. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const inline = (line: string, key: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
        <strong className="font-semibold text-white" key={`${key}-${index}`}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={`${key}-${index}`}>{part}</span>
      ),
    );
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item, `li-${blocks.length}-${index}`)}</li>);
    blocks.push(
      list.ordered ? (
        <ol className="list-decimal space-y-1 pl-4" key={`list-${blocks.length}`}>{items}</ol>
      ) : (
        <ul className="list-disc space-y-1 pl-4" key={`list-${blocks.length}`}>{items}</ul>
      ),
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (line) blocks.push(<p key={`p-${blocks.length}`}>{inline(line.replace(/^#+\s*/, ""), `p-${blocks.length}`)}</p>);
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function TypingDots() {
  return (
    <span aria-label="Rehab Companion is typing" className="chat-typing inline-flex items-center gap-1 py-1" role="status">
      <span />
      <span />
      <span />
    </span>
  );
}

export function RehabChatDrawer({ reportId, quickPrompts, onUpgrade }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The counter: Free has 3 a day and 10 in total during the first 7 days; Pro has a weekly fair-use limit it only sees when it is reached. */
  const [usage, setUsage] = useState<CompanionUsage | null>(null);
  const [limit, setLimit] = useState<LimitReason | null>(null);
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [clearing, setClearing] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const historyAbortRef = useRef<AbortController | null>(null);

  // History loads the first time the drawer opens.
  const loadHistory = () => {
    const controller = new AbortController();
    historyAbortRef.current = controller;
    setLoadingHistory(true);
    setError(null);
    fetch(`/api/chat?reportId=${encodeURIComponent(reportId ?? "")}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? "Your chat could not be loaded.");
        setMessages(
          (data.messages as ChatMessage[]).map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            guard: message.guard,
          })),
        );
        setUsage(isUsage(data.usage) ? data.usage : null);
        setLimit(isLimit(data.limit) ? data.limit : null);
        setPlan(data.plan === "free" || data.plan === "pro" ? data.plan : null);
        setLoaded(true);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Your chat could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHistory(false);
      });
  };

  const openDrawer = () => {
    setOpen(true);
    if (!loaded && !loadingHistory) loadHistory();
  };

  useEffect(
    () => () => {
      abortRef.current?.abort();
      historyAbortRef.current?.abort();
    },
    [],
  );

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open, sending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const send = async (raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || sending || text.length > MAX_CHARS) return;
    // The free messages are used up or the 7 days are over: offer Pro now instead of sending a request that will be refused.
    if (plan === "free" && (limit === "total" || limit === "window_ended")) {
      onUpgrade?.();
      return;
    }
    setError(null);
    setInput("");
    setSending(true);

    const userMessage: ChatMessage = { id: nextId(), role: "user", content: text };
    const replyId = nextId();
    setMessages((current) => [...current, userMessage, { id: replyId, role: "assistant", content: "", streaming: true }]);
    const updateReply = (patch: Partial<ChatMessage>) =>
      setMessages((current) => current.map((message) => (message.id === replyId ? { ...message, ...patch } : message)));
    const dropReply = () => setMessages((current) => current.filter((message) => message.id !== replyId));

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, message: text }),
        signal: controller.signal,
      });
      setUsage((previous) => usageFromHeaders(response.headers, previous));

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 402) {
          // The server counted this as one message too many. Undo the optimistic bubbles and keep the text.
          setMessages((current) => current.filter((message) => message.id !== replyId && message.id !== userMessage.id));
          setInput(text);
          setPlan("free");
          const block = response.headers.get("X-Chat-Block");
          setLimit(block === "window_ended" ? "window_ended" : "total");
          onUpgrade?.();
          return;
        }
        if (response.status === 429) {
          // Today's 3 are used. The server re-checks on every message, so the box stays usable and
          // the next slot opens by itself.
          setLimit(data?.reason === "weekly" ? "weekly" : "daily");
          if (isUsage(data?.usage)) setUsage(data.usage);
          updateReply({ content: data?.error ?? "You have reached the Rehab Companion's message limit for now.", guard: "rate_limit", streaming: false });
        } else {
          dropReply();
          setError(data?.error ?? "Your message could not be sent. Please try again.");
        }
        return;
      }

      // This message went through: the next one is refused only if nothing is left for it.
      setLimit(
        response.headers.get("X-Chat-Total-Left") === "0"
          ? "total"
          : response.headers.get("X-Chat-Daily-Left") === "0"
            ? "daily"
            : response.headers.get("X-Chat-Weekly-Left") === "0"
              ? "weekly"
              : null,
      );
      const guard = response.headers.get("X-Chat-Guard");
      if (guard) updateReply({ guard });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let content = "";
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          updateReply({ content });
        }
        content += decoder.decode();
      }
      if (!content.trim()) {
        dropReply();
        setError("The Rehab Companion couldn't answer just now. Please try again in a moment.");
        return;
      }
      updateReply({ content: content.trim(), streaming: false });
    } catch {
      if (controller.signal.aborted) {
        updateReply({ streaming: false });
        return;
      }
      dropReply();
      setError("Your message could not be sent. Check your connection and try again.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const clearChat = async () => {
    abortRef.current?.abort();
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });
      if (!response.ok) throw new Error();
      setMessages([]);
    } catch {
      setError("The chat could not be cleared. Please try again.");
    } finally {
      setClearing(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  const tooLong = input.length > MAX_CHARS;
  // A Free user with no messages left can still press send: that opens the upgrade offer.
  const canSend = !sending && input.trim().length > 0 && !tooLong;
  const needsUpgrade = plan === "free" && (limit === "total" || limit === "window_ended");
  const nextSlot = (limit === "daily" || limit === "weekly") && usage?.nextSlotAt ? timeOf(usage.nextSlotAt, limit === "weekly") : null;

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? "Close Rehab Companion" : "Open Rehab Companion"}
        className="chat-launcher group sticky bottom-0 z-10 mt-auto flex w-full shrink-0 items-center gap-3 rounded-2xl p-3.5 text-left"
        data-open={open}
        onClick={() => (open ? close() : openDrawer())}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="chat-launcher-icon relative grid h-11 w-11 shrink-0 place-items-center rounded-xl">
          <MessageCircle size={20} />
          <span className="chat-launcher-dot absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-white">Rehab Companion</span>
            <span className="chat-launcher-badge rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]">
              AI
            </span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-emerald-50/70">
            {open ? "Chat is open" : "Ask about your condition, today's exercises or SomaCue"}
          </span>
        </span>
        <span aria-hidden="true" className="chat-launcher-cta grid h-8 w-8 shrink-0 place-items-center rounded-lg">
          {open ? <X size={15} /> : <Send size={14} />}
        </span>
      </button>

      {open ? (
        <section
          aria-label="Rehab Companion"
          className="chat-panel fixed bottom-[6rem] left-4 top-[calc(var(--nav-h)+5rem)] z-40 flex w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl"
          id={panelId}
          role="dialog"
        >
          <header className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="chat-avatar grid h-8 w-8 place-items-center rounded-xl">
                <MessageCircle size={15} />
              </span>
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-white">Rehab Companion</h2>
                <p className="text-[10px] text-white/50">Your plan, exercises and SomaCue, explained</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Clear chat"
                className="grid h-7 w-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                disabled={clearing || sending || messages.length === 0}
                onClick={() => void clearChat()}
                title="Clear chat"
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
              <button
                aria-label="Close Rehab Companion"
                className="grid h-7 w-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                onClick={close}
                type="button"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </div>
          </header>

          <div
            aria-busy={sending}
            aria-live="polite"
            className="chat-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            ref={listRef}
          >
            {loadingHistory ? (
              <p className="py-6 text-center text-[11px] text-white/45">Loading your conversation…</p>
            ) : messages.length === 0 ? (
              <div className="py-2">
                <p className="text-[13px] leading-relaxed text-white/80">
                  Hi! I can explain your detected condition, walk you through today&apos;s exercises, and help you use
                  SomaCue.
                </p>
                <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300/80">Try asking</p>
                <div className="mt-2 flex flex-col items-start gap-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      className="chat-chip rounded-full px-3 py-1.5 text-left text-[11px]"
                      disabled={sending}
                      key={prompt}
                      onClick={() => void send(prompt)}
                      type="button"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "user" ? (
                  <div className="flex justify-end" key={message.id}>
                    <p className="chat-bubble-user max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] leading-relaxed">
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div className="flex justify-start" key={message.id}>
                    <div
                      className={`chat-bubble-assistant max-w-[90%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        message.guard === "red_flag" ? "chat-bubble-alert" : message.guard ? "chat-bubble-guard" : ""
                      }`}
                      data-guard={message.guard ?? undefined}
                    >
                      {message.guard === "red_flag" ? (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-200">Safety warning</p>
                      ) : null}
                      {message.content ? <RichText text={message.content} /> : <TypingDots />}
                    </div>
                  </div>
                ),
              )
            )}
          </div>

          {error ? (
            <p className="mx-4 mb-2 rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-[11px] text-red-100" role="alert">
              {error}
            </p>
          ) : null}

          <form
            className="border-t border-white/10 px-3 pb-3 pt-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <label className="sr-only" htmlFor={`${panelId}-input`}>
              Ask the Rehab Companion
            </label>
            <div className="chat-input flex items-end gap-2 rounded-xl px-3 py-2">
              <textarea
                className="max-h-28 min-h-[2.25rem] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-white outline-none placeholder:text-white/35"
                id={`${panelId}-input`}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={
                  needsUpgrade
                    ? "Upgrade to Pro to keep chatting"
                    : nextSlot
                      ? `Next message opens at ${nextSlot}`
                      : "Ask about your plan or exercises…"
                }
                ref={inputRef}
                rows={1}
                value={input}
              />
              <button
                aria-label="Send message"
                className="chat-send grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-35"
                disabled={!canSend}
                type="submit"
              >
                <Send aria-hidden="true" size={14} />
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-white/40">
              <span data-testid="chat-counter">
                {usage && usage.dailyLimit !== null && usage.dailyLeft !== null ? (
                  // Free: today's 3 and the 10 in the first 7 days.
                  <>
                    <span>
                      {usage.dailyLeft} of {usage.dailyLimit} left today
                      {nextSlot ? `, next at ${nextSlot}` : ""}
                    </span>
                    {usage.totalLimit !== null && usage.totalLeft !== null ? (
                      <span className="block">
                        {limit === "window_ended"
                          ? "Your 7-day free window has ended"
                          : `${usage.totalLeft} of ${usage.totalLimit} left in your first 7 days`}
                      </span>
                    ) : null}
                  </>
                ) : nextSlot ? (
                  // Pro has no counter. Only a reached fair-use limit is shown, with when it opens.
                  `Fair-use limit reached, next message at ${nextSlot}`
                ) : (
                  "Not medical advice"
                )}
              </span>
              <span aria-live="polite" className={tooLong ? "font-semibold text-red-300" : input.length > MAX_CHARS * 0.9 ? "text-amber-200" : ""}>
                {input.length}/{MAX_CHARS}
              </span>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
