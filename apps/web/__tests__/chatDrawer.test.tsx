import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RehabChatDrawer } from "@/components/workspace/RehabChatDrawer";
import type { CompanionUsage } from "@/lib/billing/plans";

const FREE_USAGE: CompanionUsage = {
  dailyLimit: 3,
  dailyLeft: 3,
  weeklyLimit: null,
  weeklyLeft: null,
  nextSlotAt: null,
  totalLimit: 10,
  totalLeft: 7,
  windowEndsAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
};
const PRO_USAGE: CompanionUsage = {
  dailyLimit: null,
  dailyLeft: null,
  weeklyLimit: 50,
  weeklyLeft: 42,
  nextSlotAt: null,
  totalLimit: null,
  totalLeft: null,
  windowEndsAt: null,
};

type History = { plan: "free" | "pro"; usage: CompanionUsage; limit?: "daily" | "weekly" | "total" | "window_ended" | null };

function mockFetch(history: History, post?: (init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init || init.method === undefined) {
        return Response.json({ messages: [], plan: history.plan, remaining: 1, usage: history.usage, limit: history.limit ?? null, maxChars: 500 });
      }
      return post ? post(init) : new Response("ok");
    }),
  );
  return calls;
}

/** Opens the panel and waits for the chat history (and with it the counter) to load. */
async function openDrawer(onUpgrade = vi.fn()) {
  render(<RehabChatDrawer onUpgrade={onUpgrade} quickPrompts={["Explain my plan"]} reportId="report-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Open Rehab Companion" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return onUpgrade;
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollTo = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Rehab Companion counter", () => {
  it("shows both limits for a Free user: 3 a day and 10 in the first 7 days", async () => {
    mockFetch({ plan: "free", usage: FREE_USAGE });
    await openDrawer();
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("3 of 3 left today");
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("7 of 10 left in your first 7 days");
  });

  it("shows no counter at all for a Pro user, daily or weekly", async () => {
    mockFetch({ plan: "pro", usage: PRO_USAGE });
    await openDrawer();
    const counter = screen.getByTestId("chat-counter");
    expect(counter).toHaveTextContent("Not medical advice");
    expect(counter).not.toHaveTextContent(/left today|of 50|of 3|first 7 days|left/);
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("keeps a Pro user's footer free of counts after a message too", async () => {
    mockFetch({ plan: "pro", usage: PRO_USAGE }, () => new Response("Here is your plan.", { headers: { "X-Chat-Weekly-Left": "41", "X-Chat-Remaining": "41" } }));
    await openDrawer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "How do I do the bridge?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText("Here is your plan.")).toBeInTheDocument());
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("Not medical advice");
    expect(screen.getByTestId("chat-counter")).not.toHaveTextContent(/41|left/);
  });

  it("counts both Free limits down from the headers after a message", async () => {
    mockFetch({ plan: "free", usage: FREE_USAGE }, () => new Response("Here is your plan.", { headers: { "X-Chat-Daily-Left": "2", "X-Chat-Total-Left": "6", "X-Chat-Remaining": "2" } }));
    await openDrawer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "How do I do the bridge?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByTestId("chat-counter")).toHaveTextContent("2 of 3 left today"));
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("6 of 10 left in your first 7 days");
  });

  it("says when the next slot opens once Free's 3 for today are used, and keeps the box usable", async () => {
    const next = new Date(Date.now() + 5 * 3_600_000).toISOString();
    mockFetch({ plan: "free", usage: { ...FREE_USAGE, dailyLeft: 0, nextSlotAt: next }, limit: "daily" });
    await openDrawer();
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("0 of 3 left today, next at");
    expect(screen.getByRole("textbox")).toBeEnabled();
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", expect.stringMatching(/^Next message opens at /));
  });

  it("shows only the reached fair-use limit to a Pro user, with the day and time it opens", async () => {
    const next = new Date(Date.now() + 3 * 86_400_000).toISOString();
    mockFetch({ plan: "pro", usage: { ...PRO_USAGE, weeklyLeft: 0, nextSlotAt: next }, limit: "weekly" });
    await openDrawer();
    const counter = screen.getByTestId("chat-counter");
    expect(counter).toHaveTextContent(/Fair-use limit reached, next message at/);
    expect(counter).not.toHaveTextContent(/of 50|left today/);
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("shows the server's friendly message when a Pro send is refused for the week", async () => {
    const next = new Date(Date.now() + 86_400_000).toISOString();
    mockFetch(
      { plan: "pro", usage: PRO_USAGE },
      () =>
        Response.json(
          { error: "You've reached the Rehab Companion's fair-use limit of 50 messages in 7 days. Your next message opens up in about 1 day (Tue 14 Jan 14:05 UTC).", guard: "rate_limit", reason: "weekly", usage: { ...PRO_USAGE, weeklyLeft: 0, nextSlotAt: next } },
          { status: 429 },
        ),
    );
    await openDrawer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "One more question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText(/fair-use limit of 50 messages in 7 days/)).toBeInTheDocument());
    expect(screen.getByTestId("chat-counter")).toHaveTextContent(/Fair-use limit reached, next message at/);
  });

  it("shows the server's friendly message when a Free send is refused for today", async () => {
    mockFetch(
      { plan: "free", usage: FREE_USAGE },
      () =>
        Response.json(
          { error: "You've used your 3 Rehab Companion messages for today. Your next message opens up in about 19 hours (Tue 14 Jan 14:05 UTC).", guard: "rate_limit", reason: "daily", usage: { ...FREE_USAGE, dailyLeft: 0, nextSlotAt: new Date(Date.now() + 3_600_000).toISOString() } },
          { status: 429 },
        ),
    );
    await openDrawer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "One more question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText(/used your 3 Rehab Companion messages for today/)).toBeInTheDocument());
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("0 of 3 left today, next at");
  });
});

describe("Free limits that need Pro", () => {
  it("opens the upgrade offer, without sending, once all 10 are used", async () => {
    const calls = mockFetch({ plan: "free", usage: { ...FREE_USAGE, totalLeft: 0 }, limit: "total" });
    const onUpgrade = await openDrawer();
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Upgrade to Pro to keep chatting");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Another one" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  });

  it.each([
    ["total", { totalLeft: 0 }],
    ["window_ended", { totalLeft: 5, windowEndsAt: new Date(Date.now() - 1000).toISOString() }],
  ] as const)("still sends a warning-sign message to the server when the Free allowance is over (%s), with no upgrade prompt first", async (limit, usage) => {
    const reply = "Please stop exercising now. What you describe can be a sign of a serious problem.";
    const calls = mockFetch({ plan: "free", usage: { ...FREE_USAGE, ...usage }, limit }, () => new Response(reply, { headers: { "X-Chat-Guard": "red_flag" } }));
    const onUpgrade = await openDrawer();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "I have chest pain and trouble breathing" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(1));
    expect(JSON.parse(String(calls.find((call) => call.init?.method === "POST")?.init?.body))).toMatchObject({ message: "I have chest pain and trouble breathing" });
    expect(await screen.findByText(/stop exercising now/i)).toBeInTheDocument();
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("still asks for Pro, without sending, for an ordinary message once the allowance is over", async () => {
    const calls = mockFetch({ plan: "free", usage: { ...FREE_USAGE, totalLeft: 0 }, limit: "total" });
    const onUpgrade = await openDrawer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Can you explain my plan?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  });
  it("says the 7-day window has ended", async () => {
    mockFetch({ plan: "free", usage: { ...FREE_USAGE, totalLeft: 5, windowEndsAt: new Date(Date.now() - 1000).toISOString() }, limit: "window_ended" });
    await openDrawer();
    expect(screen.getByTestId("chat-counter")).toHaveTextContent("Your 7-day free window has ended");
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Upgrade to Pro to keep chatting");
  });

  it("opens the upgrade offer when the server answers 402, and keeps the typed text", async () => {
    mockFetch({ plan: "free", usage: FREE_USAGE }, () => Response.json({ error: "PRO_REQUIRED", feature: "companion" }, { status: 402, headers: { "X-Chat-Block": "total" } }));
    const onUpgrade = await openDrawer();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Last try" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(onUpgrade).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox")).toHaveValue("Last try");
  });
});

describe("when the Companion cannot answer", () => {
  it("shows the server's message, takes the unanswered bubble back and keeps the text to send again", async () => {
    const message = "The Rehab Companion's AI service is busy or has reached its limit right now. Please try again in a little while. Your message was not counted.";
    mockFetch({ plan: "free", usage: FREE_USAGE }, () => Response.json({ error: message, reason: "provider" }, { status: 503 }));
    await openDrawer();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("hi");
    // the unanswered "hi" is not left in the thread
    expect(screen.queryAllByText("hi", { selector: ":not(textarea)" })).toHaveLength(0);
  });
});