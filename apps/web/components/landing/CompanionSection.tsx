"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT_LIMITS, screenChatMessage } from "@/lib/clinical/chatGuardrails";
import styles from "./sections.module.css";

type Kind = "user" | "answer" | "guard" | "alert";
type Message = { id: number; kind: Kind; text: string; label?: string };

const STARTERS = [
  "Explain my detected condition",
  "Write me a Python script",
  "I have numbness in my groin",
];

const SAMPLE_ANSWER =
  "Your assessment reads \u201cLikely lower lumbar disc bulge\u201d, derived from imaging scans & symptoms only. It is AI-generated, not a medical diagnosis. Confirm it with a clinician.";

const GUARDS = [
  { title: "Red flags first", body: "Fixed keywords, answered with a safety warning." },
  { title: "Injection and off-topic", body: "Jailbreaks, coding, homework and trivia." },
  { title: "Then the AI", body: "Only plan questions reach the model." },
];

export function CompanionSection() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const next = useRef(1);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = log.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const result = screenChatMessage(text);
    const out: Message[] = [{ id: next.current++, kind: "user", text }];
    if (result.action === "guard") {
      const alert = result.guard === "red_flag";
      out.push({
        id: next.current++,
        kind: alert ? "alert" : "guard",
        label: alert ? "Safety warning" : "Out of scope",
        text: result.reply,
      });
    } else if (result.action === "reject") {
      out.push({ id: next.current++, kind: "guard", label: "Not sent", text: result.message });
    } else if (text === STARTERS[0]) {
      out.push({ id: next.current++, kind: "answer", text: SAMPLE_ANSWER });
    } else {
      out.push({
        id: next.current++,
        kind: "answer",
        text: "This message would go to the Rehab Companion. Create an account to ask about your own plan.",
      });
    }
    setMessages((current) => [...current, ...out]);
    setDraft("");
  };

  return (
    <section className={styles.section} id="companion" aria-labelledby="companion-title">
      <div className={`${styles.wrap} ${styles.companion}`}>
        <div>
          <h2 id="companion-title" className={styles.h2}>
            A rehab chat that refuses everything else.
          </h2>
          <p className={styles.lead}>
            These are the real checks. Type a message and see which one fires.
          </p>
          <ol className={styles.guards}>
            {GUARDS.map((guard, index) => (
              <li className={styles.guard} key={guard.title}>
                <span className={styles.rungNum}>{index + 1}</span>
                <span>
                  <span className={styles.rungTitle}>{guard.title}</span>
                  <span className={styles.rungNote}>{guard.body}</span>
                </span>
              </li>
            ))}
          </ol>

        </div>

        <div className={styles.chat}>
          <div className={styles.chatHead}>
            <p className={styles.chatTitle}>Rehab Companion</p>
          </div>
          <div className={styles.chatLog} ref={log} role="log" aria-live="polite" aria-label="Chat preview">
            
            {messages.map((message) => (
              <div
                className={`${styles.bubble} ${
                  message.kind === "user"
                    ? `${styles.bubbleUser} chat-bubble-user`
                    : message.kind === "alert"
                      ? `chat-bubble-alert ${styles.bubbleSys}`
                      : message.kind === "guard"
                        ? `chat-bubble-assistant chat-bubble-guard ${styles.bubbleSys}`
                        : `chat-bubble-assistant ${styles.bubbleSys}`
                }`}
                key={message.id}
              >
                {message.label ? <p className={styles.bubbleLabel}>{message.label}</p> : null}
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <div className={styles.chips}>
            {STARTERS.map((starter) => (
              <button className={styles.chip} key={starter} onClick={() => send(starter)} type="button">
                {starter}
              </button>
            ))}
          </div>
          <form
            className={styles.chatForm}
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
          >
            <input
              aria-label="Message"
              className={styles.chatInput}
              maxLength={CHAT_LIMITS.maxMessageChars}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type a message"
              value={draft}
            />
            <span className={`${styles.count} num`}>
              {draft.length}/{CHAT_LIMITS.maxMessageChars}
            </span>
            <button className={styles.btnSolid} type="submit">
              Send
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
