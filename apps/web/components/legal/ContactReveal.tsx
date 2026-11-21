"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./legal.module.css";

type ContactRevealProps = {
  kind: "email" | "phone";
  /** Clicks needed before the value shows: 1 for email, 2 for phone. */
  steps: 1 | 2;
};

const NOUN = { email: "email address", phone: "phone number" } as const;

/**
 * Hides a support contact value behind a click so it is not in the server-rendered HTML.
 * The value is read here, from the client bundle, and never passed in as a prop: props
 * from a server component are serialised into the page's HTML.
 */
export function ContactReveal({ kind, steps }: ContactRevealProps) {
  // Literal property access, so Next inlines the value into the client bundle.
  const value = kind === "email" ? process.env.NEXT_PUBLIC_SUPPORT_EMAIL : process.env.NEXT_PUBLIC_SUPPORT_PHONE;
  const [clicks, setClicks] = useState(0);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const revealed = clicks >= steps;

  // Reveal replaces the button, so hand keyboard focus to the new link.
  useEffect(() => {
    if (revealed) linkRef.current?.focus();
  }, [revealed]);

  if (!value) return null;

  if (revealed) {
    const href = kind === "email" ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, "")}`;
    return (
      <a href={href} ref={linkRef}>
        {value}
      </a>
    );
  }

  const label = clicks === 0 ? "Click to reveal" : "Click again to reveal";
  return (
    <button
      aria-label={`${label} ${NOUN[kind]}`}
      className={styles.reveal}
      onClick={() => setClicks((count) => count + 1)}
      type="button"
    >
      {label}
    </button>
  );
}
