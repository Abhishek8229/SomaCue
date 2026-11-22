-- Promo codes grant Pro through the same subscription row a purchase uses, marked with provider "promo".
-- A later paid purchase writes "razorpay" back (grantPurchase), so the row always names the latest source.
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_provider_check";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_check" CHECK ("provider" IN ('razorpay', 'promo'));
