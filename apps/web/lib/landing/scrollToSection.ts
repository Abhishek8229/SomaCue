/*
 * Scrolls a landing page section to the middle of the screen.
 *
 * The browser's own anchor jump measures the page once. The 3D stages and images above the
 * pricing section keep changing the page's height while they load, so the jump lands short.
 * This measures again after each scroll and corrects until the position holds.
 */

/** The page y that puts a block in the middle of the space below the sticky nav (or its top just under the nav when it is taller). */
export function centeredScrollTop(input: { top: number; height: number; scrollY: number; viewportHeight: number; navHeight: number }): number {
  const available = input.viewportHeight - input.navHeight;
  const gap = Math.max(16, (available - input.height) / 2);
  return Math.max(0, input.top + input.scrollY - input.navHeight - gap);
}

const TOLERANCE_PX = 6;
const TICK_MS = 150;
/** Give up this long after the click, however the page is behaving. */
const MAX_MS = 15_000;
/** Done once the block has stayed in place this long. */
const HOLD_MS = 1_500;

export function scrollToCentered(id: string): void {
  const section = document.getElementById(id);
  if (!section) return;
  // Centre the content, not the section's own padding.
  const block = section.querySelector<HTMLElement>("[data-scroll-center]") ?? section;
  const navHeight = document.querySelector("header")?.getBoundingClientRect().height ?? 64;
  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  const target = () => {
    const rect = block.getBoundingClientRect();
    return centeredScrollTop({ top: rect.top, height: rect.height, scrollY: window.scrollY, viewportHeight: window.innerHeight, navHeight });
  };

  let timer = 0;
  const stop = () => {
    window.clearInterval(timer);
    for (const event of ["wheel", "touchstart", "keydown"] as const) window.removeEventListener(event, stop);
  };
  // The person took over: stop steering.
  for (const event of ["wheel", "touchstart", "keydown"] as const) window.addEventListener(event, stop, { passive: true });

  const startedAt = Date.now();
  let lastY = -1;
  let heldSince = 0;
  window.scrollTo({ top: target(), behavior });

  timer = window.setInterval(() => {
    const now = Date.now();
    if (now - startedAt > MAX_MS) return stop();

    const y = window.scrollY;
    const moving = Math.abs(y - lastY) >= 1;
    lastY = y;
    if (moving) {
      heldSince = 0; // still travelling
      return;
    }
    // At rest: is the block where it should be? The page above may have grown while it loaded.
    if (Math.abs(target() - y) <= TOLERANCE_PX) {
      heldSince ||= now;
      if (now - heldSince >= HOLD_MS) stop();
      return;
    }
    heldSince = 0;
    window.scrollTo({ top: target(), behavior });
  }, TICK_MS);
}