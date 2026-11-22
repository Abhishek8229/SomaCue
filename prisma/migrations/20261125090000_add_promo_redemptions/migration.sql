-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 60,
    "redeemedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromoRedemption_code_idx" ON "PromoRedemption"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_userId_code_key" ON "PromoRedemption"("userId", "code");

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;