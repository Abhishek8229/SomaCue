"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { validateEmail, validateName, validatePassword } from "@/lib/auth/validation";
import { GoogleButton } from "./GoogleButton";
import { PasswordChecklist, PasswordField, TextField } from "./fields";
import styles from "./auth.module.css";

type Errors = { name?: string; email?: string; password?: string };
type Field = keyof Errors;
type ApiResult = { error?: string; field?: string; next?: string };

export function RegisterForm({ next, initialError }: { next: string | null; initialError: string | null }) {
  const router = useRouter();
  const checklistId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const focusField = (field: Field) => {
    const target = { name: nameRef, email: emailRef, password: passwordRef }[field];
    target.current?.focus();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const found: Errors = {};
    const nameError = validateName(name);
    if (nameError) found.name = nameError;
    const emailError = validateEmail(email);
    if (emailError) found.email = emailError;
    const passwordError = validatePassword(password);
    if (passwordError) found.password = passwordError;
    setErrors(found);
    setFormError(null);
    const first = (["name", "email", "password"] as Field[]).find((field) => found[field]);
    if (first) {
      focusField(first);
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, next }),
      });
      const data = (await response.json()) as ApiResult;

      if (!response.ok) {
        const field = data.field as Field | undefined;
        if (field === "name" || field === "email" || field === "password") {
          setErrors({ [field]: data.error });
          focusField(field);
        } else {
          setFormError(data.error ?? "Registration failed. Try again.");
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

  const switchHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <>
      <header>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Register, then start your intake.</p>
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
          autoComplete="name"
          error={errors.name}
          inputRef={nameRef}
          label="Full name"
          name="name"
          onChange={(event) => setName(event.target.value)}
          type="text"
          value={name}
        />
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
          autoComplete="new-password"
          describedBy={checklistId}
          error={errors.password}
          inputRef={passwordRef}
          label="Password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          value={password}
        />
        <PasswordChecklist id={checklistId} value={password} />
        <button className={styles.submit} disabled={pending} type="submit">
          {pending ? <span aria-hidden="true" className={styles.spinner} /> : null}
          {pending ? "Creating account" : "Create account"}
        </button>
      </form>

      <p className={styles.footerLine}>
        Already registered?{" "}
        <Link className={styles.link} href={switchHref}>
          Sign in
        </Link>
      </p>
    </>
  );
}
