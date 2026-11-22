import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/dashboard" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { Navbar } from "@/components/nav/Navbar";

const patient = { id: "u1", email: "asha@example.com", name: "Asha Rao", role: "patient" as const };

afterEach(() => cleanup());

describe("Navbar", () => {
  it("labels the first signed-in link Dashboard and points it at /dashboard", () => {
    pathname.current = "/workspace";
    render(<Navbar user={patient} />);

    const nav = screen.getByRole("navigation", { name: "Signed in" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Rehab Studio" })).toHaveAttribute("href", "/workspace");
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("marks the current route", () => {
    pathname.current = "/dashboard";
    render(<Navbar user={patient} />);
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Rehab Studio" })).not.toHaveAttribute("aria-current");
  });

  it("shows the patient's name and a sign-out button", () => {
    pathname.current = "/dashboard";
    render(<Navbar user={patient} />);
    expect(screen.getByText("Pt. Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });

  it("only links to routes that exist for guests", () => {
    pathname.current = "/3d-lab";
    render(<Navbar user={null} />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/", "/#intake", "/login", "/register"]);
  });

  it.each(["/", "/login", "/register"])("steps aside on %s, which draw their own navigation", (path) => {
    pathname.current = path;
    const { container } = render(<Navbar user={patient} />);
    expect(container).toBeEmptyDOMElement();
  });
});
