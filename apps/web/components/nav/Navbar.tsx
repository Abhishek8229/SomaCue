"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/session";
import styles from "./Navbar.module.css";

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
  const badgeLabel = user?.role === "clinician" ? "Dr." : "Pt.";

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
              <Link href="/dashboard" className={styles.link}>
                Overview
              </Link>
              <Link href="/workspace" className={styles.link}>
                Workspace
              </Link>
            </div>
            <span className={styles.badge}>
              {badgeLabel} {user.name}
            </span>
            <SignOutButton />
          </nav>
        ) : (
          <nav className={styles.nav} aria-label="Guest">
            <div className={styles.links}>
              <Link href="/#platform" className={styles.link}>
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
