-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "aiReportAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiReportError" TEXT,
ADD COLUMN     "aiReportGenerating" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiReportReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiReportRetryAt" TIMESTAMP(3),
ADD COLUMN     "aiReportRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SimulationResearchReportGenerationLock" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "owner" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationResearchReportGenerationLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationResearch_status_aiReportReady_finishedAt_idx" ON "SimulationResearch"("status", "aiReportReady", "finishedAt");

-- CreateIndex
CREATE INDEX "SimulationResearch_status_aiReportReady_aiReportRetryAt_fin_idx" ON "SimulationResearch"("status", "aiReportReady", "aiReportRetryAt", "finishedAt");
