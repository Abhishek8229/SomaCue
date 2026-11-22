import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { getCurrentUser } from "@/lib/auth/session";
import { getDashboardSnapshot } from "@/lib/dashboard/queries";
import { getRecoveryTimeline } from "@/lib/recovery/server";

export const metadata: Metadata = { title: "Dashboard | SomaCue" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/dashboard");

  const [snapshot, timeline] = await Promise.all([getDashboardSnapshot(user), getRecoveryTimeline(user).catch((error: unknown) => {
      // The rest of the dashboard still works without the timeline.
      console.error("[SomaCue timeline] Could not load the Recovery Timeline.", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  return <DashboardView snapshot={snapshot} timeline={timeline} />;
}
