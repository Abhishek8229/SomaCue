import { Workspace } from "@/components/workspace/Workspace";
import type { DemoId } from "@/lib/assets";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialDemo: DemoId = requested === "anatomy" ? "anatomy" : "movement";

  return <Workspace initialDemo={initialDemo} />;
}
