"use client";

import { useEffect } from "react";
import { scrollToCentered } from "@/lib/landing/scrollToSection";

/** Opening the page at /#pricing lands in the middle of the section too, not just above it. */
export function InitialHashScroll({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return;
    const frame = requestAnimationFrame(() => scrollToCentered(id));
    return () => cancelAnimationFrame(frame);
  }, [id]);
  return null;
}
