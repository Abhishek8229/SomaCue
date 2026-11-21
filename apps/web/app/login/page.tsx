import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
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

  return <AuthShell error={authErrorMessage(first(params.error))} mode="login" next={next} />;
}
