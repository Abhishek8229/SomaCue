"use client";

import { useCallback, useRef, useState } from "react";
import { fetchBillingStatus, runProCheckout } from "@/lib/billing/checkout";
import { DEFAULT_TIER, PRO_TIERS, type BillingStatus, type ProTier, type UpgradeReason } from "@/lib/billing/plans";

export type CheckoutPhase = "idle" | "starting" | "confirming";

/**
 * Billing state for the workspace: the current plan, the Upgrade and Manage dialogs, the chosen
 * Pro tier and the checkout action. The server is the source of truth; this only mirrors it so
 * the UI can react without a reload.
 *
 * `recommended` is the tier that covers the user's rehab plan (null before an analysis). It is
 * preselected until the user picks another one.
 */
export function useBilling(
  initial: BillingStatus,
  user: { name?: string; email?: string },
  recommended: ProTier | null = null,
  /** open the dialog on this tier at load (a link from the pricing page) */
  opening: ProTier | null = null,
) {
  const [billing, setBilling] = useState(initial);
  /** why the Upgrade dialog is open, or null when it is closed */
  const [upgradeFeature, setUpgradeFeature] = useState<UpgradeReason | null>(
    opening ? (initial.plan === "pro" ? "renew" : "general") : null,
  );
  const [manageOpen, setManageOpen] = useState(false);
  const [phase, setPhase] = useState<CheckoutPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickedTier, setPickedTier] = useState<ProTier | null>(opening);
  const busy = useRef(false);

  const tier: ProTier = pickedTier ?? recommended ?? DEFAULT_TIER;

  const refresh = useCallback(async () => {
    const next = await fetchBillingStatus();
    if (next) setBilling(next);
    return next;
  }, []);

  /** `preselect` opens the dialog on a given tier (for example from a link on the pricing page). */
  const openUpgrade = useCallback((feature: UpgradeReason = "general", preselect: ProTier | null = null) => {
    setError(null);
    setPickedTier(preselect);
    setUpgradeFeature(feature);
  }, []);
  const closeUpgrade = useCallback(() => {
    // Closing during payment confirmation would hide the only sign of progress.
    if (!busy.current) setUpgradeFeature(null);
  }, []);

  const startCheckout = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPhase("starting");
    try {
      const outcome = await runProCheckout(user, tier);
      if (outcome.kind === "paid") {
        setBilling(outcome.billing);
        setUpgradeFeature(null);
        setNotice(`You're on SomaCue Pro for ${PRO_TIERS[tier].name}. Every Pro feature is unlocked.`);
      } else if (outcome.kind === "failed") {
        setError(outcome.message);
        // A payment that went through but could not be confirmed may have unlocked Pro anyway.
        void refresh();
      }
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }, [user, tier, refresh]);

  return {
    billing,
    isPro: billing.plan === "pro",
    upgradeFeature,
    manageOpen,
    phase,
    error,
    notice,
    tier,
    recommended,
    selectTier: setPickedTier,
    refresh,
    openUpgrade,
    closeUpgrade,
    openManage: () => {
      setError(null);
      setManageOpen(true);
    },
    closeManage: () => setManageOpen(false),
    dismissNotice: () => setNotice(null),
    startCheckout,
  };
}

export type BillingController = ReturnType<typeof useBilling>;
