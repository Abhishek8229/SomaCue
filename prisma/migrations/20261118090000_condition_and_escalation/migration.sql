-- AlterTable
ALTER TABLE "ClinicalReport" ADD COLUMN     "careReason" TEXT,
ADD COLUMN     "conditionSource" TEXT,
ADD COLUMN     "conditionSummary" TEXT,
ADD COLUMN     "conditionTitle" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "escalationEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "escalationKind" TEXT,
ADD COLUMN     "escalationReason" TEXT,
ADD COLUMN     "requiresInPersonCare" BOOLEAN NOT NULL DEFAULT false;
