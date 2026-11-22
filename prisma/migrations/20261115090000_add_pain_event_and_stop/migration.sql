-- AlterTable
ALTER TABLE "DailyProgress" ADD COLUMN "stoppedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "PainEvent" (
    "id" TEXT NOT NULL,
    "clinicalReportId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "exerciseNames" TEXT[],
    "painType" TEXT NOT NULL,
    "regions" TEXT[],
    "details" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "rescheduledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PainEvent_patientId_idx" ON "PainEvent"("patientId");

-- CreateIndex
CREATE INDEX "PainEvent_clinicalReportId_dateKey_idx" ON "PainEvent"("clinicalReportId", "dateKey");

-- AddForeignKey
ALTER TABLE "PainEvent" ADD CONSTRAINT "PainEvent_clinicalReportId_fkey" FOREIGN KEY ("clinicalReportId") REFERENCES "ClinicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
