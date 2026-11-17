"use client";

import { useId, useState, type InputHTMLAttributes, type Ref } from "react";
import { passwordRules } from "@/lib/auth/validation";
import styles from "./auth.module.css";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
  /** Id of extra help text (for example the password checklist). */
  describedBy?: string;
};

export function TextField({ label, error, inputRef, describedBy, ...input }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const described = [error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          {...input}
          aria-describedby={described}
          aria-invalid={error ? true : undefined}
          className={styles.input}
          id={id}
          ref={inputRef}
        />
      </div>
      {error ? (
        <p className={styles.fieldError} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PasswordField({ label, error, inputRef, describedBy, ...input }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  const described = [error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.inputWrap}>
        <input
          {...input}
          aria-describedby={described}
          aria-invalid={error ? true : undefined}
          className={`${styles.input} ${styles.inputWithToggle}`}
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className={styles.toggle}
          onClick={() => setVisible((value) => !value)}
          type="button"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {error ? (
        <p className={styles.fieldError} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Live view of the password rules; the server enforces the same ones. */
export function PasswordChecklist({ value, id }: { value: string; id: string }) {
  return (
    <ul aria-label="Password requirements" className={styles.checklist} id={id}>
      {passwordRules(value).map((rule) => (
        <li className={styles.rule} data-met={rule.met} key={rule.id}>
          {rule.label}
          <span className="visually-hidden">{rule.met ? " (met)" : " (not met yet)"}</span>
        </li>
      ))}
    </ul>
  );
}
