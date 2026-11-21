"use client";

import type { ReactNode } from "react";
import { scrollToCentered } from "@/lib/landing/scrollToSection";

/** An in-page link that lands in the middle of its section, even while the page above is still loading. */
export function SectionLink({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <a
      className={className}
      href={`#${id}`}
      onClick={(event) => {
        // Let new-tab and modified clicks behave normally.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.history.replaceState(null, "", `#${id}`);
        scrollToCentered(id);
      }}
    >
      {children}
    </a>
  );
}
