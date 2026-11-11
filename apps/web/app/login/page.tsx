"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./Login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Sign in failed. Try again.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");
      router.push(from && from.startsWith("/") ? from : "/dashboard");
      router.refresh();
    } catch {
      setError("Sign in failed. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>Sign in</h1>
          <p className={styles.subtitle}>Access your rehabilitation workspace.</p>
        </header>

        {error ? (
          <div className={styles.alert} role="alert">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className={styles.submit} type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className={styles.switch}>
          No account? <Link href="/register">Create one</Link>
        </p>
      </section>
    </main>
  );
}
