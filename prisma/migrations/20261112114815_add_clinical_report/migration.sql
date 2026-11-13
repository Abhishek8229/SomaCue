-- CreateTable
CREATE TABLE "ClinicalReport" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL DEFAULT 1,
    "primarySymptoms" TEXT NOT NULL,
    "fileUrls" TEXT[],
    "adaptiveData" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClinicalReport_patientId_idx" ON "ClinicalReport"("patientId");

-- CreateIndex
CREATE INDEX "ClinicalReport_createdAt_idx" ON "ClinicalReport"("createdAt");
