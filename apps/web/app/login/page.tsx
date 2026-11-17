import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { authErrorMessage } from "@/lib/auth/messages";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in to SomaCue" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // "from" is what older links used before ?next=.
  const requested = first(params.next) ?? first(params.from);
  const next = requested ? safeNextPath(requested) : null;

  return (
    <AuthShell mode="login" next={next}>
      <LoginForm initialError={authErrorMessage(first(params.error))} next={next} />
    </AuthShell>
  );
}
