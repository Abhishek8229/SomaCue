import { AlertTriangle } from "lucide-react";

/**
 * Standard urgent-care notice shown whenever a session is stopped with Pain
 * Override. Draft wording: needs clinical and legal review before public rollout.
 */
export function SafetyNotice({ compact = false }: { compact?: boolean }) {
  const emergencyNumber = process.env.NEXT_PUBLIC_EMERGENCY_NUMBER?.trim();
  return (
    <div
      className={`rounded-xl border border-red-300/40 bg-red-400/10 text-red-50 ${compact ? "px-3 py-2" : "px-4 py-3"}`}
      role="alert"
    >
      <p className="flex items-center gap-2 text-xs font-semibold text-red-100">
        <AlertTriangle aria-hidden="true" size={14} />
        Stop exercising now
      </p>
      <p className={`mt-1 leading-relaxed text-red-100/85 ${compact ? "text-[10px]" : "text-[11px]"}`}>
        If you have sudden severe pain, chest pain, numbness or tingling, loss of bladder or bowel
        control, or you cannot move an arm or leg, get urgent medical care now. Call{" "}
        {emergencyNumber ? <strong>{emergencyNumber}</strong> : "your local emergency number"}.
      </p>
      {compact ? null : (
        <p className="mt-1 text-[10px] text-red-100/60">
          SomaCue is not an emergency service and cannot contact anyone for you.
        </p>
      )}
    </div>
  );
}
