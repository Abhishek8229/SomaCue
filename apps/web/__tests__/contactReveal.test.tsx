import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ContactReveal } from "@/components/legal/ContactReveal";

const EMAIL = "help@somacue.invalid";
const PHONE = "+91 98765 43210";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("ContactReveal", () => {
  it("keeps the email out of the initial markup and reveals it in one click", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", EMAIL);
    const { container } = render(<ContactReveal kind="email" steps={1} />);

    expect(container.innerHTML).not.toContain(EMAIL);
    fireEvent.click(screen.getByRole("button", { name: /click to reveal/i }));

    const link = screen.getByRole("link", { name: EMAIL });
    expect(link).toHaveAttribute("href", `mailto:${EMAIL}`);
    expect(link).toHaveFocus();
  });

  it("needs two clicks to reveal the phone number", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_PHONE", PHONE);
    const { container } = render(<ContactReveal kind="phone" steps={2} />);

    expect(container.innerHTML).not.toContain("98765");
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toHaveTextContent("Click again to reveal");
    expect(container.innerHTML).not.toContain("98765");
    fireEvent.click(screen.getByRole("button"));

    const link = screen.getByRole("link", { name: PHONE });
    expect(link).toHaveAttribute("href", "tel:+919876543210");
  });

  it("renders nothing when the value is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    const { container } = render(<ContactReveal kind="email" steps={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
