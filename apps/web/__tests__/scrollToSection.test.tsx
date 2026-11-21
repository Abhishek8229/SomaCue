import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectionLink } from "@/components/landing/SectionLink";
import { centeredScrollTop } from "@/lib/landing/scrollToSection";

describe("centeredScrollTop", () => {
  const base = { scrollY: 0, viewportHeight: 900, navHeight: 64 };

  it("puts a block shorter than the screen in the middle of the space under the nav", () => {
    // 836px of room under the nav, a 436px block: 200px of air above and below it.
    expect(centeredScrollTop({ ...base, top: 3000, height: 436 })).toBe(3000 - 64 - 200);
  });

  it("starts a block taller than the screen just under the nav", () => {
    expect(centeredScrollTop({ ...base, top: 3000, height: 1100 })).toBe(3000 - 64 - 16);
  });

  it("measures from where the page is scrolled to, and never goes above the top", () => {
    expect(centeredScrollTop({ ...base, scrollY: 2000, top: 1000, height: 436 })).toBe(3000 - 64 - 200);
    expect(centeredScrollTop({ ...base, top: 10, height: 436 })).toBe(0);
  });
});

describe("SectionLink", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    document.body.insertAdjacentHTML(
      "beforeend",
      '<header></header><section id="pricing"><div id="inner" data-scroll-center></div></section>',
    );
    const inner = document.getElementById("inner") as HTMLElement;
    inner.getBoundingClientRect = () => ({ top: 2400, height: 600, bottom: 3000, left: 0, right: 0, width: 0, x: 0, y: 2400, toJSON() {} }) as DOMRect;
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/");
  });

  it("scrolls the content of the section to the middle instead of jumping to its edge", () => {
    render(<SectionLink id="pricing">Pricing</SectionLink>);
    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link).toHaveAttribute("href", "#pricing");

    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false); // default jump was cancelled
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const call = scrollTo.mock.calls[0][0] as { top: number; behavior: string };
    // jsdom: window.innerHeight 768, no real header, so the nav height falls back to 0 here
    expect(call.top).toBe(Math.max(0, 2400 - Math.max(16, (768 - 600) / 2)));
    expect(call.behavior).toBe("smooth");
    expect(window.location.hash).toBe("#pricing");
  });

  it("leaves a new-tab click to the browser", () => {
    render(<SectionLink id="pricing">Pricing</SectionLink>);
    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Pricing" }), { ctrlKey: true });
    expect(notPrevented).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
