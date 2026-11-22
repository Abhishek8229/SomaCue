"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { useUpgradeNav } from "@/lib/billing/navBridge";
import styles from "./Navbar.module.css";

const LEGAL_PATHS = ["/pricing", "/terms", "/privacy", "/refunds", "/contact"];

type NavbarProps = {
  user: SessionUser | null;
};

function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const handleSignOut = async () => {
    if (inFlight.current) return;

    inFlight.current = true;
    setPending(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" }).catch(
        () => null,
      );

      if (!response?.ok) return;

      router.push("/login");
      router.refresh();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleSignOut}
      disabled={pending}
    >
      {pending ? "Signing out..." : "Sign Out"}
    </button>
  );
}

export function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const badgeLabel = user?.role === "clinician" ? "Dr." : "Pt.";
  // The workspace publishes this once it knows the user is on the Free plan.
  const upgradeNav = useUpgradeNav();
  const showUpgrade = pathname.startsWith("/workspace") && upgradeNav.visible && upgradeNav.open !== null;

  // The landing, auth and public policy pages draw their own navigation.
  if (pathname === "/" || pathname === "/login" || pathname === "/register" || LEGAL_PATHS.includes(pathname)) return null;

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">S</span>
          <span>SomaCue</span>
        </Link>
        {user ? (
          <nav className={styles.nav} aria-label="Signed in">
            <div className={styles.links}>
              <Link
                href="/dashboard"
                className={styles.link}
                aria-current={pathname.startsWith("/dashboard") ? "page" : undefined}
              >
                Dashboard
              </Link>
              <Link
                href="/workspace"
                className={styles.link}
                aria-current={pathname.startsWith("/workspace") ? "page" : undefined}
              >
                Rehab Studio
              </Link>
              {showUpgrade ? (
                <button className={styles.upgrade} onClick={() => upgradeNav.open?.()} type="button">
                  Upgrade to Pro
                </button>
              ) : null}
            </div>
            <span className={styles.badge}>
              {badgeLabel} {user.name}
            </span>
            <SignOutButton />
          </nav>
        ) : (
          <nav className={styles.nav} aria-label="Guest">
            <div className={styles.links}>
              <Link href="/#intake" className={styles.link}>
                How it works
              </Link>
            </div>
            <Link href="/login" className={styles.link}>Sign in</Link>
            <Link href="/register" className={styles.button}>
              Get started
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
