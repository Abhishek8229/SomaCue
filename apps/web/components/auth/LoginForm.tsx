"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { validateEmail, validateLoginPassword } from "@/lib/auth/validation";
import { GoogleButton } from "./GoogleButton";
import { PasswordField, TextField } from "./fields";
import styles from "./auth.module.css";

type Errors = { email?: string; password?: string };
type ApiResult = { error?: string; field?: string; next?: string };

export function LoginForm({ next, initialError }: { next: string | null; initialError: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const found: Errors = {};
    const emailError = validateEmail(email);
    if (emailError) found.email = emailError;
    const passwordError = validateLoginPassword(password);
    if (passwordError) found.password = passwordError;
    setErrors(found);
    setFormError(null);
    if (found.email || found.password) {
      (found.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next }),
      });
      const data = (await response.json()) as ApiResult;

      if (!response.ok) {
        if (data.field === "email" || data.field === "password") {
          setErrors({ [data.field]: data.error });
          (data.field === "email" ? emailRef : passwordRef).current?.focus();
        } else {
          setFormError(data.error ?? "Sign in failed. Try again.");
        }
        return;
      }

      router.push(data.next ?? "/workspace");
      router.refresh();
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  };

  const switchHref = next ? `/register?next=${encodeURIComponent(next)}` : "/register";

  return (
    <>
      <header>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Open your Rehab Studio.</p>
      </header>

      {formError ? (
        <div className={styles.banner} role="alert">
          {formError}
        </div>
      ) : null}

      <GoogleButton next={next} />
      <p className={styles.divider}>or continue with email</p>

      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        <TextField
          autoComplete="email"
          error={errors.email}
          inputMode="email"
          inputRef={emailRef}
          label="Email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          value={email}
        />
        <PasswordField
          autoComplete="current-password"
          error={errors.password}
          inputRef={passwordRef}
          label="Password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          value={password}
        />
        <button className={styles.submit} disabled={pending} type="submit">
          {pending ? <span aria-hidden="true" className={styles.spinner} /> : null}
          {pending ? "Signing in" : "Sign in"}
        </button>
      </form>

      <p className={styles.footerLine}>
        New to SomaCue?{" "}
        <Link className={styles.link} href={switchHref}>
          Create an account
        </Link>
      </p>
    </>
  );
}
