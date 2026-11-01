import type { Metadata } from "next";
import { LabWorkspace } from "@/components/lab/LabWorkspace";

export const metadata: Metadata = {
  title: "SomaCue · 3D lab (experimental)",
  description:
    "Experimental compatibility test: a full-body anatomy dataset, a rigged human and a motion clip.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <LabWorkspace />;
}
