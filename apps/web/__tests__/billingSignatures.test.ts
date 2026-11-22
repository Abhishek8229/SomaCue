// @vitest-environment node
import { describe, expect, it } from "vitest";
import { signCheckout, signWebhookBody, verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/billing/razorpay";

/*
 * The expected signatures below were computed with Node's crypto in a separate script, not with
 * the code under test, so a change to the algorithm cannot pass by agreeing with itself.
 */
const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "whsec_test_secret";
const CHECKOUT_SIGNATURE = "9ba0aff54764dde2623cb81d3b0a1b7e0eba1eaa66852ccdb0dffd503820658c"; // pay_TestPay1|sub_TestSub1
const SWAPPED_CHECKOUT_SIGNATURE = "354205e71db1ea5197522a385c7ce5a0987b9d1bb46fc71e6826bc0e4cb96c62"; // sub_TestSub1|pay_TestPay1
const BODY = '{"event":"subscription.charged","payload":{}}';
const WEBHOOK_SIGNATURE = "c5f48628d6088306aacba5df41f8458221aaa3c0f4ea3fd504715f4696cf2dbe";

describe("webhook signature", () => {
  it("accepts the signature Razorpay would send for the exact body", () => {
    expect(verifyWebhookSignature(BODY, WEBHOOK_SIGNATURE, WEBHOOK_SECRET)).toBe(true);
    expect(signWebhookBody(BODY, WEBHOOK_SECRET)).toBe(WEBHOOK_SIGNATURE);
  });

  it("rejects a body changed by a single character", () => {
    expect(verifyWebhookSignature(BODY.replace("charged", "chargex"), WEBHOOK_SIGNATURE, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a body that is the same JSON but not the same bytes", () => {
    // The signature covers the raw text, so re-serialising it (as JSON.stringify would) breaks it.
    const prettyPrinted = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyWebhookSignature(prettyPrinted, WEBHOOK_SIGNATURE, WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWebhookSignature(BODY, signWebhookBody(BODY, "another_secret"), WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects empty, short, long and non-hex signatures without throwing", () => {
    for (const bad of ["", "abc", `${WEBHOOK_SIGNATURE}00`, "z".repeat(64), WEBHOOK_SIGNATURE.slice(0, -1)]) {
      expect(verifyWebhookSignature(BODY, bad, WEBHOOK_SECRET)).toBe(false);
    }
  });
});

describe("checkout signature", () => {
  const input = { paymentId: "pay_TestPay1", subscriptionId: "sub_TestSub1", signature: CHECKOUT_SIGNATURE };

  it("accepts payment_id|subscription_id, the order Razorpay signs for subscriptions", () => {
    expect(verifyCheckoutSignature(input, KEY_SECRET)).toBe(true);
    expect(signCheckout("pay_TestPay1", "sub_TestSub1", KEY_SECRET)).toBe(CHECKOUT_SIGNATURE);
  });

  it("rejects the order used for one-time orders (subscription_id|payment_id)", () => {
    expect(verifyCheckoutSignature({ ...input, signature: SWAPPED_CHECKOUT_SIGNATURE }, KEY_SECRET)).toBe(false);
  });

  it("rejects a signature for a different payment or subscription", () => {
    expect(verifyCheckoutSignature({ ...input, paymentId: "pay_Other" }, KEY_SECRET)).toBe(false);
    expect(verifyCheckoutSignature({ ...input, subscriptionId: "sub_Other" }, KEY_SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret, and an empty one", () => {
    expect(verifyCheckoutSignature(input, "not_the_secret")).toBe(false);
    expect(verifyCheckoutSignature({ ...input, signature: "" }, KEY_SECRET)).toBe(false);
  });
});
