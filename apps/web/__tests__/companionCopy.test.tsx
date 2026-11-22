import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => null }));
vi.mock("@/lib/billing/entitlements", () => ({ getUserPlan: async () => "free", getBillingStatus: async () => null }));
vi.mock("@/lib/billing/recommend", () => ({ getRecommendedTier: async () => null }));

import PricingPage from "@/app/pricing/page";
import TermsPage from "@/app/terms/page";
import { ManageSubscription } from "@/components/billing/ManageSubscription";
import { PricingProCard } from "@/components/billing/PricingProCard";
import { UpgradeModal } from "@/components/billing/UpgradeModal";
import { COMPARISON_ROWS } from "@/lib/billing/copy";
import { usageSummary, type BillingStatus } from "@/lib/billing/plans";

afterEach(() => cleanup());

const free: BillingStatus = { plan: "free", status: null, currentPeriodEnd: null, tier: null, usage: usageSummary("free", { analyses: 1, companionMessages: 4 }) };
const pro: BillingStatus = { plan: "pro", status: "active", currentPeriodEnd: "2026-12-10T12:00:00.000Z", tier: "1m", usage: usageSummary("pro", { analyses: 3, companionMessages: 80 }) };
const noop = () => {};

describe("Pro Rehab Companion wording: unlimited, with fair use", () => {
  it("is in the Free vs Pro table: Free keeps its limits, Pro says unlimited", () => {
    const row = COMPARISON_ROWS.find((item) => item.feature === "Rehab Companion");
    expect(row).toEqual({
      feature: "Rehab Companion",
      free: "3 a day, 10 in total during your first 7 days",
      pro: "Unlimited chat (practically unlimited; fair-use limits apply if abused)",
    });
  });

  it("is on the pricing card and in the upgrade dialog", () => {
    render(<PricingProCard isPro={false} recommended={null} signedIn />);
    expect(screen.getByText("Unlimited Rehab Companion chat (fair-use limits apply)")).toBeInTheDocument();
    cleanup();

    render(<UpgradeModal accessEndsAt={null} error={null} feature="companion" onClose={noop} onSelectTier={noop} onUpgrade={noop} phase="idle" recommended={null} tier="1m" />);
    expect(screen.getByRole("dialog")).toHaveTextContent(/Pro removes those limits for unlimited chat, with fair use applying/);
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/3 messages a day, for as long/);
  });

  it("is in the general upgrade pitch too", () => {
    render(<UpgradeModal accessEndsAt={null} error={null} feature="general" onClose={noop} onSelectTier={noop} onUpgrade={noop} phase="idle" recommended={null} tier="1m" />);
    expect(screen.getByRole("dialog")).toHaveTextContent(/unlimited Rehab Companion chat/);
  });

  it("is in the account panel for Pro, and Free still sees its own limits", () => {
    render(<ManageSubscription billing={pro} error={null} notice={null} onClose={noop} onRenew={noop} onUpgrade={noop} />);
    expect(screen.getByTestId("pro-companion-line")).toHaveTextContent("Rehab Companion: unlimited chat (fair-use limits apply).");
    cleanup();

    render(<ManageSubscription billing={free} error={null} notice={null} onClose={noop} onRenew={noop} onUpgrade={noop} />);
    expect(screen.queryByTestId("pro-companion-line")).not.toBeInTheDocument();
    expect(screen.getByText(/Rehab Companion: 4 of 10 messages used \(3 a day\)/)).toBeInTheDocument();
  });

  it("is on /pricing, with the real fair-use numbers in the fine print", async () => {
    render(await PricingPage());
    expect(screen.getAllByText("Unlimited chat (practically unlimited; fair-use limits apply if abused)").length).toBeGreaterThan(0);
    expect(screen.getByText(/Pro chat is unlimited in practice/)).toHaveTextContent(/fair-use limit of 50 messages in any 7 days applies/);
    expect(screen.getByText(/Pro chat is unlimited in practice/)).toHaveTextContent(/Free allows 3 messages in any 24 hours and 10 in total/);
  });

  it("is in the terms, with the fair-use numbers", () => {
    render(<TermsPage />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/unlimited Rehab Companion chat/);
    expect(text).toMatch(/up to\s*50 messages in any rolling 7 days \(168 hours\)/);
    expect(text).not.toMatch(/3 messages in any 24 hours, with no total cap/);
  });
});
