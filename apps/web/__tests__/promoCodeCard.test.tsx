import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManageSubscription } from "@/components/billing/ManageSubscription";
import { PromoCodeCard } from "@/components/billing/PromoCodeCard";
import type { BillingStatus } from "@/lib/billing/plans";
import { redeemPromoCode } from "@/lib/billing/promoClient";

const usage = { analysesUsed: 0, companionMessagesUsed: 0 } as BillingStatus["usage"];
const FREE: BillingStatus = { plan: "free", status: null, currentPeriodEnd: null, tier: null, usage };
const PRO: BillingStatus = { plan: "pro", status: "active", currentPeriodEnd: "2027-01-24T10:00:00.000Z", tier: "2m", usage };

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.stubGlobal("fetch", respond(200, {}));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PromoCodeCard", () => {
  it("shows the heading, a labelled input with a placeholder and a disabled Apply button", () => {
    render(<PromoCodeCard onApplied={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Apply your promo code" })).toBeTruthy();
    expect(screen.getByLabelText("Promo code").getAttribute("placeholder")).toBe("Enter promo code");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Apply disabled for a blank code and enables it once there is text", () => {
    render(<PromoCodeCard onApplied={vi.fn()} />);
    const input = screen.getByLabelText("Promo code");
    const apply = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: "   " } });
    expect(apply.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " code " } });
    expect(apply.disabled).toBe(false);
  });

  it("sends the trimmed code, shows the loading state, then reports success", async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    const onApplied = vi.fn();
    render(<PromoCodeCard onApplied={onApplied} />);

    fireEvent.change(screen.getByLabelText("Promo code"), { target: { value: "  somacue2m  " } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const busy = await screen.findByRole("button", { name: "Applying…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Promo code") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(busy); // a second click while loading does nothing
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/billing/promo");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: "somacue2m" });

    finish(
      new Response(JSON.stringify({ redeemed: true, durationDays: 60, expiresAt: PRO.currentPeriodEnd, billing: PRO }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect((await screen.findByRole("status")).textContent).toContain("2 months");
    expect(onApplied).toHaveBeenCalledWith(PRO, PRO.currentPeriodEnd);
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true); // input cleared
  });

  it("shows the server's message inline when the code is refused, and keeps the text", async () => {
    vi.stubGlobal("fetch", respond(400, { error: "INVALID_CODE", message: "That promo code isn't valid. Check it and try again." }));
    const onApplied = vi.fn();
    render(<PromoCodeCard onApplied={onApplied} />);

    fireEvent.change(screen.getByLabelText("Promo code"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect((await screen.findByRole("alert")).textContent).toContain("isn't valid");
    expect(onApplied).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Promo code") as HTMLInputElement).value).toBe("nope");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits with Enter", async () => {
    const fetchMock = respond(409, { message: "You've already used this promo code." });
    vi.stubGlobal("fetch", fetchMock);
    render(<PromoCodeCard onApplied={vi.fn()} />);
    const input = screen.getByLabelText("Promo code");
    fireEvent.change(input, { target: { value: "used" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect((await screen.findByRole("alert")).textContent).toContain("already used");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<PromoCodeCard onApplied={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Promo code"), { target: { value: "code" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach the server");
  });
});

describe("redeemPromoCode client", () => {
  it("reads a success response", async () => {
    vi.stubGlobal("fetch", respond(200, { redeemed: true, durationDays: 60, expiresAt: PRO.currentPeriodEnd, billing: PRO }));
    expect(await redeemPromoCode("X")).toEqual({ kind: "ok", billing: PRO, expiresAt: PRO.currentPeriodEnd, durationDays: 60 });
  });

  it("uses a generic message for an error with no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 })));
    expect(await redeemPromoCode("X")).toEqual({ kind: "failed", message: "Could not apply the promo code. Please try again." });
  });

  it("does not trust a 200 without a plan in it", async () => {
    vi.stubGlobal("fetch", respond(200, { redeemed: true }));
    expect((await redeemPromoCode("X")).kind).toBe("failed");
  });
});

describe("ManageSubscription promo card", () => {
  const props = { error: null, notice: null, onClose: vi.fn(), onRenew: vi.fn(), onUpgrade: vi.fn() };

  it("shows the card to a free user when promo codes are wired", () => {
    render(<ManageSubscription {...props} billing={FREE} onPromoApplied={vi.fn()} />);
    expect(screen.getByTestId("promo-code-card")).toBeTruthy();
  });

  it("hides the card for a Pro user", async () => {
    render(<ManageSubscription {...props} billing={PRO} onPromoApplied={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTestId("promo-code-card")).toBeNull());
  });

  it("hides the card when no handler is given", () => {
    render(<ManageSubscription {...props} billing={FREE} />);
    expect(screen.queryByTestId("promo-code-card")).toBeNull();
  });
});
