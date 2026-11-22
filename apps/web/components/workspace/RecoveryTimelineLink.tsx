import Link from "next/link";
import { RECOVERY_TIMELINE_HREF } from "@/lib/recovery/links";

/**
 * A small pill in Rehab Studio that points to the Recovery Timeline on the Dashboard. The timeline fills
 * itself in as the plan goes on, so the studio only needs to say where it is.
 */
export function RecoveryTimelineLink() {
  return (
    <Link
      className="group inline-flex min-h-7 w-fit max-w-full items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[10px] leading-tight text-white/60 transition-colors hover:border-emerald-300/50 hover:text-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      data-testid="recovery-timeline-link"
      href={RECOVERY_TIMELINE_HREF}
    >
      <span>Chronological Recovery Timeline available in Dashboard</span>
      <svg aria-hidden="true" className="shrink-0 transition-transform group-hover:translate-x-0.5" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </Link>
  );
}