import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  user: null as { id: string; name: string; email: string } | null,
  runProCheckout: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/billing/entitlements", () => ({ getBillingStatus: async () => null }));
vi.mock("@/lib/billing/recommend", () => ({ getRecommendedTier: async () => null }));
vi.mock("@/lib/billing/checkout", () => ({
  runProCheckout: mocks.runProCheckout,
  fetchBillingStatus: async () => null,
}));

import { LandingNav } from "@/components/landing/LandingNav";
import { PricingPanel } from "@/components/landing/PricingPanel";
import { PricingSection } from "@/components/landing/PricingSection";
import { COMPARISON_ROWS, FUNDING_NOTE } from "@/lib/billing/copy";
import { usageSummary, type BillingStatus } from "@/lib/billing/plans";

const FREE: BillingStatus = { plan: "free", status: null, currentPeriodEnd: null, tier: null, usage: usageSummary("free", { analyses: 1, companionMessages: 0 }) };
const signedIn = { name: "Asha Rao", email: "asha@example.com" };

beforeEach(() => {
  mocks.user = null;
  mocks.runProCheckout.mockReset();
});
afterEach(() => cleanup());

describe("landing navbar", () => {
  it("puts a highlighted Pricing link right after Safety, pointing at #pricing", () => {
    render(<LandingNav />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const links = within(nav).getAllByRole("link");
    const labels = links.map((link) => link.textContent);
    expect(labels).toEqual(["Intake", "Triage", "3D guidance", "Companion", "Safety", "Pricing"]);

    const pricing = links[labels.indexOf("Pricing")];
    expect(pricing).toHaveAttribute("href", "#pricing");
    expect(links[labels.indexOf("Safety")].nextElementSibling).toBe(pricing);
    expect(pricing.className).toMatch(/anchorHighlight/);
    // only Pricing is highlighted
    expect(links.filter((link) => /anchorHighlight/.test(link.className))).toHaveLength(1);
  });
});

describe("landing pricing section", () => {
  it("shows the same table, tiers and funding note as the upgrade dialog, under a #pricing anchor", async () => {
    render(await PricingSection());

    const section = document.getElementById("pricing");
    expect(section).not.toBeNull();
    expect(section).toHaveAttribute("aria-labelledby", "pricing-title");

    const table = within(section as HTMLElement).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(COMPARISON_ROWS.length);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["Discovery triage", "Daily schedule", "Rehab Companion", "3D movement stage"]);
    expect(table).toHaveTextContent("Week 1 only (Days 1–7)");
    expect(table).toHaveTextContent("Unlimited chat (practically unlimited; fair-use limits apply if abused)");
    expect(table).not.toHaveTextContent(/pain override/i);

    const tiers = screen.getByTestId("tier-options").textContent ?? "";
    expect(tiers).toContain("₹199");
    expect(tiers).toContain("₹299");
    expect(tiers).toContain("₹349");
    expect(tiers).toContain("save ₹99");
    expect(tiers).toContain("save ₹248");
    expect(tiers).not.toMatch(/₹(499|599)/);

    expect(screen.getByTestId("funding-note")).toHaveTextContent(FUNDING_NOTE);
  });
});

describe("landing pricing panel, signed out", () => {
  it("sends the upgrade button to /register and carries the chosen tier through sign-up", () => {
    render(<PricingPanel billing={null} recommended={null} user={null} />);
    const button = screen.getByRole("link", { name: /Upgrade to Pro for 1 month, ₹199/ });
    expect(button).toHaveAttribute("href", `/register?next=${encodeURIComponent("/workspace?upgrade=1m")}`);

    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.getByRole("link", { name: /Upgrade to Pro for 2 months, ₹299/ })).toHaveAttribute(
      "href",
      `/register?next=${encodeURIComponent("/workspace?upgrade=2m")}`,
    );
    fireEvent.click(screen.getAllByRole("radio")[2]);
    expect(screen.getByRole("link", { name: /Upgrade to Pro for 3 months, ₹349/ })).toHaveAttribute(
      "href",
      `/register?next=${encodeURIComponent("/workspace?upgrade=3m")}`,
    );
    expect(screen.getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/register");
    expect(mocks.runProCheckout).not.toHaveBeenCalled();
  });

  it("puts the funding note above the button", () => {
    render(<PricingPanel billing={null} recommended={null} user={null} />);
    const note = screen.getByTestId("funding-note");
    const button = screen.getByRole("link", { name: /Upgrade to Pro for/ });
    expect(note.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("landing pricing panel, signed in", () => {
  it("preselects and badges the tier for the user's plan", () => {
    render(<PricingPanel billing={FREE} recommended="3m" user={signedIn} />);
    expect(screen.getAllByRole("radio")[2]).toBeChecked();
    expect(screen.getByText("Personalized for your analysis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upgrade to Pro for 3 months, ₹349/ })).toBeInTheDocument();
  });

  it("opens checkout for the chosen tier instead of leaving the page", async () => {
    const paid: BillingStatus = { ...FREE, plan: "pro", status: "active", tier: "2m", currentPeriodEnd: new Date(Date.now() + 60 * 86_400_000).toISOString() };
    mocks.runProCheckout.mockResolvedValue({ kind: "paid", billing: paid });
    render(<PricingPanel billing={FREE} recommended={null} user={signedIn} />);

    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.queryByRole("link", { name: /Upgrade to Pro/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Upgrade to Pro for 2 months, ₹299/ }));

    expect(mocks.runProCheckout).toHaveBeenCalledWith({ name: "Asha Rao", email: "asha@example.com" }, "2m");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You're on SomaCue Pro for 2 months"));
    // now a Pro user: the buy block is gone, only the confirmation stays
    expect(screen.queryByRole("button", { name: /for 2 months/ })).not.toBeInTheDocument();
  });

  it("shows a failed payment's message and keeps the button usable", async () => {
    mocks.runProCheckout.mockResolvedValue({ kind: "failed", message: "The payment did not go through." });
    render(<PricingPanel billing={FREE} recommended={null} user={signedIn} />);
    fireEvent.click(screen.getByRole("button", { name: /Upgrade to Pro for 1 month/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The payment did not go through."));
    expect(screen.getByRole("button", { name: /Upgrade to Pro for 1 month/ })).toBeEnabled();
  });

  it("shows a Pro user no renewal text, buttons or links under the tiers", () => {
    const pro: BillingStatus = { ...FREE, plan: "pro", status: "active", tier: "1m", currentPeriodEnd: "2026-12-10T12:00:00.000Z" };
    render(<PricingPanel billing={pro} recommended={null} user={signedIn} />);
    const panel = screen.getByTestId("landing-pricing-panel");
    expect(panel).not.toHaveTextContent(/You are on Pro until/);
    expect(panel).not.toHaveTextContent(/Secure payment by Razorpay/);
    expect(within(panel).queryByRole("button")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("link")).not.toBeInTheDocument();
    // the funding note and tiers are still there
    expect(screen.getByTestId("funding-note")).toBeInTheDocument();
  });
});
