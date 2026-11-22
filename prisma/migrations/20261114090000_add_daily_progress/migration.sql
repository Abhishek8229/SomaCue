-- CreateTable
CREATE TABLE "DailyProgress" (
    "id" TEXT NOT NULL,
    "clinicalReportId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "completedExercises" TEXT[],
    "completedAt" TIMESTAMPTZ(3),
    "feedback" TEXT,
    "notes" TEXT,
    "discomfortExercises" TEXT[],
    "discomfortDetails" TEXT,
    "rescheduledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DailyProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyProgress_patientId_idx" ON "DailyProgress"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyProgress_clinicalReportId_dateKey_key" ON "DailyProgress"("clinicalReportId", "dateKey");

-- AddForeignKey
ALTER TABLE "DailyProgress" ADD CONSTRAINT "DailyProgress_clinicalReportId_fkey" FOREIGN KEY ("clinicalReportId") REFERENCES "ClinicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
