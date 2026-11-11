-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalAssessment" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "clinicianId" TEXT,
    "rawReportText" TEXT NOT NULL,
    "extractedDiagnosis" JSONB NOT NULL,
    "safetyStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "movementPlanes" TEXT[],

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescribedMovement" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,

    CONSTRAINT "PrescribedMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ClinicalAssessment_patientId_idx" ON "ClinicalAssessment"("patientId");

-- CreateIndex
CREATE INDEX "ClinicalAssessment_clinicianId_idx" ON "ClinicalAssessment"("clinicianId");

-- CreateIndex
CREATE INDEX "ClinicalAssessment_safetyStatus_idx" ON "ClinicalAssessment"("safetyStatus");

-- CreateIndex
CREATE INDEX "Exercise_name_idx" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "PrescribedMovement_assessmentId_idx" ON "PrescribedMovement"("assessmentId");

-- CreateIndex
CREATE INDEX "PrescribedMovement_exerciseId_idx" ON "PrescribedMovement"("exerciseId");

-- AddForeignKey
ALTER TABLE "ClinicalAssessment" ADD CONSTRAINT "ClinicalAssessment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalAssessment" ADD CONSTRAINT "ClinicalAssessment_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescribedMovement" ADD CONSTRAINT "PrescribedMovement_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ClinicalAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescribedMovement" ADD CONSTRAINT "PrescribedMovement_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
