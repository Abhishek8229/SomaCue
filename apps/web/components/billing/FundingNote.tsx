import { FUNDING_NOTE } from "@/lib/billing/copy";

/**
 * Why Pro costs money, set to be read first: larger type, pure white on a warm tinted panel with
 * a bright edge. Used above the buttons in the upgrade dialog and on the pricing card.
 */
export function FundingNote({ className = "" }: { className?: string }) {
  return (
    <p
      className={`rounded-xl border border-amber-300/50 border-l-4 border-l-amber-300 bg-amber-300/15 px-4 py-3 text-[15px] font-medium leading-relaxed text-white ${className}`}
      data-testid="funding-note"
    >
      {FUNDING_NOTE}
    </p>
  );
}
