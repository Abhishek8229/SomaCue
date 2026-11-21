import { getCurrentUser } from "@/lib/auth/session";
import { getBillingStatus } from "@/lib/billing/entitlements";
import { billingFailure, billingJson } from "@/lib/billing/http";

/** The signed-in user's plan, subscription state and remaining Free usage. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return billingJson({ error: "Please sign in." }, 401);

  try {
    return billingJson(await getBillingStatus(user.id));
  } catch (error) {
    return billingFailure(error, "status");
  }
}
