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

  // The server renders in UTC; the browser swaps in its own local day after the first render.
  return <DashboardView serverTodayKey={new Date().toISOString().slice(0, 10)} snapshot={snapshot} />;
}
