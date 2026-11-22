import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/use-environment", () => ({
  useWebGLSupport: () => "unavailable",
  usePrefersReducedMotion: () => false,
}));

import { AuthShell } from "@/components/auth/AuthShell";
import { AuthStage } from "@/components/auth/AuthStage";
import { authErrorMessage } from "@/lib/auth/messages";

afterEach(() => cleanup());

describe("sign in and create account pages", () => {
  for (const mode of ["login", "register"] as const) {
    describe(mode, () => {
      it("offers Continue with Google as the only way in: no email, password or form fields", () => {
        const { container } = render(<AuthShell error={null} mode={mode} next={null} />);
        const card = screen.getByTestId("auth-card");

        const google = within(card).getByRole("link", { name: "Continue with Google" });
        expect(google).toHaveAttribute("href", "/api/auth/google");

        expect(container.querySelectorAll("input")).toHaveLength(0);
        expect(container.querySelectorAll("form")).toHaveLength(0);
        expect(container.textContent).not.toMatch(/email and password|use your email|continue with email|or continue/i);
      });

      it("carries the safe ?next= through Google and the page switch", () => {
        render(<AuthShell error={null} mode={mode} next="/workspace?upgrade=2m" />);
        expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
          "href",
          `/api/auth/google?next=${encodeURIComponent("/workspace?upgrade=2m")}`,
        );
        const other = mode === "login" ? "/register" : "/login";
        expect(within(screen.getByTestId("auth-card")).getAllByRole("link").some((link) => link.getAttribute("href") === `${other}?next=${encodeURIComponent("/workspace?upgrade=2m")}`)).toBe(true);
      });

      it("links the Terms and the Privacy policy", () => {
        render(<AuthShell error={null} mode={mode} next={null} />);
        const card = screen.getByTestId("auth-card");
        expect(within(card).getByRole("link", { name: "Terms and conditions" })).toHaveAttribute("href", "/terms");
        expect(within(card).getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
      });

      it("has one h1 and shows a failed sign-in as an alert", () => {
        render(<AuthShell error={authErrorMessage("google_failed")} mode={mode} next={null} />);
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("We couldn't complete Google sign-in. Please try again.");
      });
    });
  }

  it("says what one click does on each page", () => {
    const { unmount } = render(<AuthShell error={null} mode="login" next={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Sign in");
    expect(screen.getByText(/1-click sign-in/)).toBeInTheDocument();
    unmount();
    render(<AuthShell error={null} mode="register" next={null} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your account");
    expect(screen.getByText(/Instant account setup/)).toBeInTheDocument();
    expect(screen.getByText(/Gmail address and photo/)).toBeInTheDocument();
  });

  it("no longer has fallback copy for an email and password sign-in", () => {
    for (const code of ["google_not_configured", "google_cancelled", "google_failed", "google_unverified", "google_state", "google_conflict", "anything_else"]) {
      expect(authErrorMessage(code)).not.toMatch(/password|your email/i);
    }
  });

  it("shows the live stage beside the card", () => {
    render(<AuthShell error={null} mode="login" next={null} />);
    expect(screen.getByRole("region", { name: "Live 3D movement stage" })).toBeInTheDocument();
    expect(screen.getByText("Supine Pelvic Tilt")).toBeInTheDocument();
  });
});

describe("live stage controls", () => {
  it("lets the visitor slow the motion to 0.5x and pause it", () => {
    render(<AuthStage />);
    const full = screen.getByRole("button", { name: "1.0x" });
    const half = screen.getByRole("button", { name: "0.5x" });
    expect(full).toHaveAttribute("aria-pressed", "true");
    expect(half).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(half);
    expect(half).toHaveAttribute("aria-pressed", "true");
    expect(full).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Pause the demonstration" }));
    expect(screen.getByRole("button", { name: "Play the demonstration" })).toHaveTextContent("Play");
  });
});
