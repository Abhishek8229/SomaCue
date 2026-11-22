import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const nav = vi.hoisted(() => ({ pathname: "/workspace" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ExpiryBanner } from "@/components/billing/ExpiryBanner";
import { PricingProCard } from "@/components/billing/PricingProCard";
import { TierSelector } from "@/components/billing/TierSelector";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { Navbar } from "@/components/nav/Navbar";
import { FUNDING_NOTE } from "@/lib/billing/copy";
import { publishUpgradeNav } from "@/lib/billing/navBridge";
import type { ProTier } from "@/lib/billing/plans";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  act(() => publishUpgradeNav(null));
});

describe("expiry banner", () => {
  it("tells a Free user on Day 5 to 7 that free access ends soon, and opens the Upgrade dialog", () => {
    const onUpgrade = vi.fn();
    const onRenew = vi.fn();
    render(<ExpiryBanner notice={{ kind: "free_week_ending", daysLeft: 2 }} onRenew={onRenew} onUpgrade={onUpgrade} />);

    const banner = screen.getByTestId("expiry-banner");
    expect(banner).toHaveAttribute("data-kind", "free_week_ending");
    expect(banner).toHaveTextContent(
      "Your free access to the daily schedule will expire soon — Upgrade to Pro to unlock your full recovery schedule",
    );
    // translucent, blurred surface
    expect(banner.className).toMatch(/backdrop-blur/);
    expect(banner.className).toMatch(/bg-zinc-900\/60/);

    fireEvent.click(within(banner).getByRole("button", { name: "Upgrade to Pro" }));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onRenew).not.toHaveBeenCalled();
  });

  it("tells a Pro user within 7 days of expiry to renew, and opens renewal", () => {
    const onUpgrade = vi.fn();
    const onRenew = vi.fn();
    const endsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    render(<ExpiryBanner notice={{ kind: "pro_expiring", daysLeft: 3, endsAt }} onRenew={onRenew} onUpgrade={onUpgrade} />);

    const banner = screen.getByTestId("expiry-banner");
    expect(banner).toHaveAttribute("data-kind", "pro_expiring");
    expect(banner).toHaveTextContent(
      "Your access to the daily schedule will expire soon — Renew your subscription to keep uninterrupted access",
    );
    expect(banner).toHaveTextContent("3 days left");

    fireEvent.click(within(banner).getByRole("button", { name: "Renew Subscription" }));
    expect(onRenew).toHaveBeenCalledTimes(1);
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it("can be dismissed for the session, and stays dismissed when it renders again", () => {
    const view = render(<ExpiryBanner notice={{ kind: "free_week_ending", daysLeft: 1 }} onRenew={vi.fn()} onUpgrade={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss for this session" }));
    expect(screen.queryByTestId("expiry-banner")).not.toBeInTheDocument();

    view.unmount();
    render(<ExpiryBanner notice={{ kind: "free_week_ending", daysLeft: 1 }} onRenew={vi.fn()} onUpgrade={vi.fn()} />);
    expect(screen.queryByTestId("expiry-banner")).not.toBeInTheDocument();
  });

  it("keeps the two banners independent: dismissing one does not hide the other", () => {
    render(<ExpiryBanner notice={{ kind: "free_week_ending", daysLeft: 1 }} onRenew={vi.fn()} onUpgrade={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss for this session" }));
    cleanup();
    render(<ExpiryBanner notice={{ kind: "pro_expiring", daysLeft: 2, endsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }} onRenew={vi.fn()} onUpgrade={vi.fn()} />);
    expect(screen.getByTestId("expiry-banner")).toBeInTheDocument();
  });
});

describe("tier selector", () => {
  function Harness({ recommended }: { recommended: ProTier | null }) {
    const [tier, setTier] = useState<ProTier>(recommended ?? "1m");
    return <TierSelector name="t" onChange={setTier} recommended={recommended} value={tier} />;
  }

  it("shows ₹199, ₹299 and ₹349 for 1, 2 and 3 months", () => {
    render(<Harness recommended={null} />);
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(3);
    const text = screen.getByTestId("tier-options").textContent ?? "";
    expect(text).toContain("1 month, 30 days");
    expect(text).toContain("₹199");
    expect(text).toContain("2 months, 60 days");
    expect(text).toContain("₹299");
    expect(text).toContain("3 months, 90 days");
    expect(text).toContain("₹349");
    expect(text).toContain("Discounted bundle");
    expect(text).toContain("Best-value discounted bundle");
    expect(screen.queryByText("Personalized for your analysis")).not.toBeInTheDocument();
  });

  it("preselects and badges the tier for the user's analysis, whichever it is", () => {
    for (const [recommended, index] of [["1m", 0], ["2m", 1], ["3m", 2]] as const) {
      const { container, unmount } = render(<Harness recommended={recommended} />);
      expect(screen.getAllByRole("radio")[index]).toBeChecked();
      const badge = screen.getByText("Personalized for your analysis");
      expect(container.querySelectorAll("label")[index]).toContainElement(badge);
      unmount();
    }
  });

  it("lets a user whose analysis needs 30 days switch to the 60 or 90 day bundle", () => {
    render(<Harness recommended="1m" />);
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.getAllByRole("radio")[1]).toBeChecked();
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(screen.getAllByRole("radio")[2]).toBeChecked();
    // The badge stays on the user's own tier.
    expect(screen.getByText("Personalized for your analysis").closest("label")).toBe(screen.getAllByRole("radio")[0].closest("label"));
  });
});

describe("upgrade modal", () => {
  const baseProps = {
    feature: "general" as const,
    phase: "idle" as const,
    error: null,
    accessEndsAt: null,
    onSelectTier: vi.fn(),
    onUpgrade: vi.fn(),
    onClose: vi.fn(),
  };

  it("shows the updated comparison, without any Pain Override row", () => {
    render(<UpgradeModal {...baseProps} recommended={null} tier="1m" />);
    const dialog = screen.getByRole("dialog");
    const table = within(dialog).getByRole("table");

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
      "Discovery triage",
      "Daily schedule",
      "Rehab Companion",
      "3D movement stage",
    ]);
    expect(table).toHaveTextContent("Week 1 only (Days 1–7)");
    expect(table).toHaveTextContent("Full adaptive schedule — Day 1 to full plan duration (at least 1 month)");
    expect(table).toHaveTextContent("3 a day, 10 in total during your first 7 days");
    expect(table).toHaveTextContent("Unlimited chat (practically unlimited; fair-use limits apply if abused)");
    expect(table).toHaveTextContent("1 analysis");
    expect(table).toHaveTextContent("Unlimited re-analysis");
    expect(dialog).not.toHaveTextContent(/pain override/i);
  });

  it("shows the funding note first, above the table and the buttons, in large bright type", () => {
    render(<UpgradeModal {...baseProps} recommended={null} tier="1m" />);
    const note = screen.getByTestId("funding-note");
    expect(note).toHaveTextContent(FUNDING_NOTE);
    const dialog = screen.getByRole("dialog");
    expect(note.compareDocumentPosition(within(dialog).getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(screen.getByRole("button", { name: /Upgrade to Pro for/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.className).toMatch(/text-\[15px\]/);
    expect(note.className).toMatch(/font-medium/);
    expect(note.className).toMatch(/text-white(\s|$)/);
    expect(FUNDING_NOTE).toBe(
      "Upgrading to SomaCue Pro isn't about being greedy — we need a sustainable way to fund AI API costs and cloud deployment costs.",
    );
  });

  it("puts the price of the chosen tier on the button, and reports the choice", () => {
    const onSelectTier = vi.fn();
    const { rerender } = render(<UpgradeModal {...baseProps} onSelectTier={onSelectTier} recommended="2m" tier="2m" />);
    expect(screen.getByRole("button", { name: /Upgrade to Pro for 2 months, ₹299/ })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")[1]).toBeChecked();
    expect(screen.getByText("Personalized for your analysis")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(onSelectTier).toHaveBeenCalledWith("3m");

    rerender(<UpgradeModal {...baseProps} onSelectTier={onSelectTier} recommended="2m" tier="3m" />);
    expect(screen.getByRole("button", { name: /Upgrade to Pro for 3 months, ₹349/ })).toBeInTheDocument();
  });

  it("explains that renewing adds days after the current end date", () => {
    render(<UpgradeModal {...baseProps} accessEndsAt="2026-12-10T12:00:00.000Z" feature="renew" recommended={null} tier="1m" />);
    expect(screen.getByRole("heading", { name: "Renew SomaCue Pro" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/Your Pro access ends on 10 December 2026/);
    expect(screen.getByRole("button", { name: /Renew for 1 month, ₹199/ })).toBeInTheDocument();
  });
});

describe("pricing page Pro card", () => {
  it("preselects the tier for the user's analysis and switches price and link when another is chosen", () => {
    render(<PricingProCard isPro={false} recommended="1m" signedIn />);
    const card = screen.getByTestId("pricing-pro-card");
    expect(card).toHaveTextContent("₹199");
    expect(within(card).getByRole("link", { name: /Upgrade for 1 month, ₹199/ })).toHaveAttribute("href", "/workspace?upgrade=1m");

    fireEvent.click(within(card).getAllByRole("radio")[1]);
    expect(card).toHaveTextContent("for 2 months (60 days)");
    expect(within(card).getByRole("link", { name: /Upgrade for 2 months, ₹299/ })).toHaveAttribute("href", "/workspace?upgrade=2m");

    fireEvent.click(within(card).getAllByRole("radio")[2]);
    expect(within(card).getByRole("link", { name: /Upgrade for 3 months, ₹349/ })).toHaveAttribute("href", "/workspace?upgrade=3m");
    expect(within(card).getByText("Personalized for your analysis").closest("label")).toBe(within(card).getAllByRole("radio")[0].closest("label"));
  });

  it("starts on the 3 month tier when the analysis plan is 3 months", () => {
    render(<PricingProCard isPro={false} recommended="3m" signedIn />);
    expect(screen.getAllByRole("radio")[2]).toBeChecked();
    expect(screen.getByTestId("pricing-pro-card")).toHaveTextContent("₹349");
  });

  it("sends a signed-out visitor through registration and back to the chosen tier", () => {
    render(<PricingProCard isPro={false} recommended={null} signedIn={false} />);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.getByRole("link", { name: "Register, then upgrade" })).toHaveAttribute(
      "href",
      `/register?next=${encodeURIComponent("/workspace?upgrade=2m")}`,
    );
  });

  it("puts the funding note above the upgrade button, large and high-contrast", () => {
    render(<PricingProCard isPro={false} recommended={null} signedIn />);
    const note = screen.getByTestId("funding-note");
    const cta = screen.getByRole("link", { name: /Upgrade for/ });
    expect(note.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.className).toMatch(/text-\[15px\]/);
    expect(note.className).toMatch(/text-white(\s|$)/);
    expect(note.className).not.toMatch(/text-white\/\d/);
  });

  it("offers a Pro user a renewal, and carries the funding note", () => {
    render(<PricingProCard isPro recommended={null} signedIn />);
    expect(screen.getByRole("link", { name: /Renew for 1 month/ })).toBeInTheDocument();
    expect(screen.getByTestId("funding-note")).toHaveTextContent(FUNDING_NOTE);
    expect(screen.getByTestId("pricing-pro-card")).not.toHaveTextContent(/pain override/i);
  });
});

describe("navbar upgrade button", () => {
  const user = { id: "u1", email: "asha@example.com", name: "Asha Rao", role: "patient" as const };

  it("shows Upgrade to Pro beside Rehab Studio on the workspace for a Free user, and opens the dialog", () => {
    nav.pathname = "/workspace";
    const open = vi.fn();
    render(<Navbar user={user} />);
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).not.toBeInTheDocument();

    act(() => publishUpgradeNav({ visible: true, open }));
    const button = screen.getByRole("button", { name: "Upgrade to Pro" });
    // right next to the Rehab Studio link
    expect(screen.getByRole("link", { name: "Rehab Studio" }).nextElementSibling).toBe(button);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("is hidden for a Pro user and away from the workspace", () => {
    nav.pathname = "/workspace";
    render(<Navbar user={user} />);
    act(() => publishUpgradeNav({ visible: false, open: vi.fn() }));
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).not.toBeInTheDocument();

    cleanup();
    nav.pathname = "/dashboard";
    render(<Navbar user={user} />);
    act(() => publishUpgradeNav({ visible: true, open: vi.fn() }));
    expect(screen.queryByRole("button", { name: "Upgrade to Pro" })).not.toBeInTheDocument();
  });
});
