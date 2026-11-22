-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "tier" TEXT;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tier_check" CHECK ("tier" IS NULL OR "tier" IN ('1m', '2m', '3m'));

-- CreateTable
CREATE TABLE "pro_purchases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_subscription_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "provider_payment_id" TEXT,
    "paid_at" TIMESTAMPTZ(3),
    "access_start" TIMESTAMPTZ(3),
    "access_end" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pro_purchases_tier_check" CHECK ("tier" IN ('1m', '2m', '3m')),
    CONSTRAINT "pro_purchases_status_check" CHECK ("status" IN ('created', 'paid'))
);

-- CreateIndex
CREATE UNIQUE INDEX "pro_purchases_provider_subscription_id_key" ON "pro_purchases"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "pro_purchases_user_id_created_at_idx" ON "pro_purchases"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "pro_purchases" ADD CONSTRAINT "pro_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
