import { COMPARISON_ROWS } from "@/lib/billing/copy";

/** Free vs Pro, one row per feature. Shared by the upgrade dialog and the landing page pricing section. */
export function ComparisonTable({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const size = compact ? "text-xs" : "text-sm";
  const pad = compact ? "px-3 py-2.5" : "px-4 py-3.5";
  return (
    <table
      className={`w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-white/10 text-left ${size} ${className}`}
      data-testid="comparison-table"
    >
      <caption className="sr-only">What is included in Free and in Pro</caption>
      <thead>
        <tr className="bg-zinc-950/60 text-white/60">
          <th className={`${compact ? "px-3 py-2" : "px-4 py-3"} font-medium`} scope="col">
            <span className="sr-only">Feature</span>
          </th>
          <th className={`${compact ? "px-3 py-2" : "px-4 py-3"} font-medium`} scope="col">
            Free
          </th>
          <th className={`bg-emerald-300/10 ${compact ? "px-3 py-2" : "px-4 py-3"} font-semibold text-emerald-200`} scope="col">
            Pro
          </th>
        </tr>
      </thead>
      <tbody>
        {COMPARISON_ROWS.map((row) => (
          <tr key={row.feature}>
            <th className={`border-t border-white/10 ${pad} font-medium text-white/85`} scope="row">
              {row.feature}
            </th>
            <td className={`border-t border-white/10 ${pad} text-white/60`}>{row.free}</td>
            <td className={`border-t border-white/10 bg-emerald-300/5 ${pad} text-emerald-100`}>{row.pro}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
