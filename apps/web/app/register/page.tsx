import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { authErrorMessage } from "@/lib/auth/messages";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Create your SomaCue account" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requested = first(params.next);
  const next = requested ? safeNextPath(requested) : null;

  return (
    <AuthShell mode="register" next={next}>
      <RegisterForm initialError={authErrorMessage(first(params.error))} next={next} />
    </AuthShell>
  );
}
