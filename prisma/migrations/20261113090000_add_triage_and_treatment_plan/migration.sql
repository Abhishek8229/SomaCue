-- Creates TriageQuiz, QuizAnswer and TreatmentPlan as they were before 20261123090000_add_plan_precautions
-- (which adds the two precaution columns to TreatmentPlan). Earlier databases were created with
-- `prisma db push`, so these tables may already exist: every statement is safe to run again.

-- CreateTable
CREATE TABLE IF NOT EXISTS "TriageQuiz" (
    "id" TEXT NOT NULL,
    "clinicalReportId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "QuizAnswer" (
    "id" TEXT NOT NULL,
    "triageQuizId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TreatmentPlan" (
    "id" TEXT NOT NULL,
    "clinicalReportId" TEXT NOT NULL,
    "routine" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TriageQuiz_clinicalReportId_key" ON "TriageQuiz"("clinicalReportId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QuizAnswer_triageQuizId_idx" ON "QuizAnswer"("triageQuizId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QuizAnswer_triageQuizId_questionId_key" ON "QuizAnswer"("triageQuizId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TreatmentPlan_clinicalReportId_key" ON "TreatmentPlan"("clinicalReportId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TreatmentPlan_createdAt_idx" ON "TreatmentPlan"("createdAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TriageQuiz_clinicalReportId_fkey' AND conrelid = '"TriageQuiz"'::regclass) THEN
        ALTER TABLE "TriageQuiz" ADD CONSTRAINT "TriageQuiz_clinicalReportId_fkey" FOREIGN KEY ("clinicalReportId") REFERENCES "ClinicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuizAnswer_triageQuizId_fkey' AND conrelid = '"QuizAnswer"'::regclass) THEN
        ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_triageQuizId_fkey" FOREIGN KEY ("triageQuizId") REFERENCES "TriageQuiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TreatmentPlan_clinicalReportId_fkey' AND conrelid = '"TreatmentPlan"'::regclass) THEN
        ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_clinicalReportId_fkey" FOREIGN KEY ("clinicalReportId") REFERENCES "ClinicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;