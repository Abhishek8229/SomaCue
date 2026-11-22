-- CreateTable
CREATE TABLE "RecoveryEvent" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicalReportId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dateKey" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecoveryEvent_patientId_occurredAt_idx" ON "RecoveryEvent"("patientId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryEvent_patientId_dedupeKey_key" ON "RecoveryEvent"("patientId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "RecoveryEvent" ADD CONSTRAINT "RecoveryEvent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryEvent" ADD CONSTRAINT "RecoveryEvent_clinicalReportId_fkey" FOREIGN KEY ("clinicalReportId") REFERENCES "ClinicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
