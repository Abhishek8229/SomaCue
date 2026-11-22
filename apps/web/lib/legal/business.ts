/*
 * Who runs SomaCue, as shown on the public legal pages.
 *
 * Razorpay's live KYC checks that these pages show real business details, so they are
 * read from the environment and never invented here. Anything left empty is shown as
 * "not published yet" rather than filled in with a made-up value. Set them in
 * apps/web/.env (see the root .env.example) before applying for live payments.
 */

const clean = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const BUSINESS = {
  productName: "SomaCue",
  /** the registered name of the person or company that operates the service */
  legalName: clean(process.env.NEXT_PUBLIC_BUSINESS_LEGAL_NAME),
  supportEmail: clean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
  supportPhone: clean(process.env.NEXT_PUBLIC_SUPPORT_PHONE),
  /** the registered or operating address, on one line or with line breaks */
  address: clean(process.env.NEXT_PUBLIC_BUSINESS_ADDRESS),
} as const;

/** The date the policies were last reviewed. Change it when their wording changes. */
export const POLICIES_UPDATED = "19 November 2026";

/** "SomaCue, operated by Acme Health Pvt Ltd", or just "SomaCue" while the legal name is unset. */
export function operatorLine() {
  return BUSINESS.legalName ? `${BUSINESS.productName}, operated by ${BUSINESS.legalName}` : BUSINESS.productName;
}

export const LEGAL_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/terms", label: "Terms and conditions" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/refunds", label: "Cancellation and refunds" },
  { href: "/contact", label: "Contact us" },
] as const;
