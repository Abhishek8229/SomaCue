import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { getCurrentUser } from "@/lib/auth/session";
import { getDashboardSnapshot } from "@/lib/dashboard/queries";

export const metadata: Metadata = { title: "Dashboard | SomaCue" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const snapshot = await getDashboardSnapshot(user);

  return <DashboardView snapshot={snapshot} />;
}
