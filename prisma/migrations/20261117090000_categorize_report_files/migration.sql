-- AlterTable
ALTER TABLE "ClinicalReport" ADD COLUMN "scanUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "prescriptionUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "aiDisclaimerAcceptedAt" TIMESTAMPTZ(3);
