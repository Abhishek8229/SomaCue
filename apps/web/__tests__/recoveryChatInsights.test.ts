import { describe, expect, it } from "vitest";
import { extractChatInsight } from "@/lib/recovery/chatInsights";
import { chatInsightEvent, toneOf } from "@/lib/recovery/timeline";

const category = (message: string) => extractChatInsight(message)?.category ?? null;

describe("chat insight capture: what goes on the timeline", () => {
  it("catches a new symptom", () => {
    expect(extractChatInsight("I noticed a tingling feeling in my left foot this morning.")).toEqual({
      category: "new_symptom",
      text: "I noticed a tingling feeling in my left foot this morning.",
    });
    expect(category("I have numbness down my right leg now")).toBe("new_symptom");
    expect(category("Since yesterday I also have a sore patch near my hip.")).toBe("new_symptom");
  });

  it("catches a pain trigger", () => {
    expect(category("My back hurts when I sit for more than half an hour.")).toBe("pain_trigger");
    expect(category("I get a sharp ache during the cat cow movement.")).toBe("pain_trigger");
  });

  it("catches trouble with a specific movement", () => {
    expect(category("I can't bend down to put on my socks without pain.")).toBe("movement_difficulty");
    expect(category("I'm struggling with the glute bridge, it is hard to lift my hips.")).toBe("movement_difficulty");
  });

  it("catches a functional improvement", () => {
    expect(category("I can walk to the shop now without any pain.")).toBe("improvement");
    expect(category("My knee feels much better and the stiffness is reduced.")).toBe("improvement");
    expect(toneOf({ kind: "chat_insight", meta: { feedback: "relief" } })).toBe("good");
  });

  it("catches a worsening", () => {
    expect(category("The pain is getting worse and spreading down my leg.")).toBe("worsening");
  });

  it("picks the most safety-relevant statement when a message has several, and keeps only the useful sentence", () => {
    const result = extractChatInsight("Thanks for the help yesterday. My shoulder feels better. But my pain is spreading into my arm.");
    expect(result).toEqual({ category: "worsening", text: "But my pain is spreading into my arm." });
  });
});

describe("chat insight capture: what stays out", () => {
  it.each([
    "Hi there",
    "Thanks, that makes sense!",
    "ok great, see you tomorrow",
    "I love this app, the 3D figure is fun.",
    "Can you recommend a good movie for tonight?",
    "My favourite team won the match yesterday.",
    "What is a disc bulge?",
    "Should I do the bridge exercise every day?",
    "Is it normal for my back to feel stiff in the morning?",
    "How many reps of pelvic tilt should I do?",
    "What if my leg went numb during an exercise?",
    "I don't have any numbness or tingling.",
    "I have no pain at the moment and no swelling.",
    "Tell me about the plan for next week.",
  ])("ignores %s", (message) => {
    expect(extractChatInsight(message)).toBeNull();
  });

  it("returns null for empty and very short input", () => {
    expect(extractChatInsight("")).toBeNull();
    expect(extractChatInsight("   ")).toBeNull();
    expect(extractChatInsight("ow")).toBeNull();
  });

  it("is cheap: no AI, plain rules, instant on a long message", () => {
    const long = `${"I am writing a very long message about nothing in particular. ".repeat(200)}My back hurts when I bend.`;
    const started = performance.now();
    const result = extractChatInsight(long);
    expect(performance.now() - started).toBeLessThan(250);
    expect(result?.category).toBe("pain_trigger");
  });
});

describe("chatInsightEvent", () => {
  it("quotes the patient's own words and has a stable key per message", () => {
    const event = chatInsightEvent({
      messageId: "msg-9",
      reportId: "report-1",
      category: "pain_trigger",
      text: "My back hurts when I sit.",
      at: new Date("2026-11-20T10:00:00Z"),
    });
    expect(event).toMatchObject({
      key: "chat:msg-9",
      kind: "chat_insight",
      title: "Pain trigger mentioned in chat",
      detail: '"My back hurts when I sit."',
      reportId: "report-1",
    });
  });
});
