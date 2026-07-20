/*
  Warnings:

  - A unique constraint covering the columns `[dedupeKey]` on the table `SimulationEvaluatorTask` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SimulationEvaluatorTask" ADD COLUMN     "dedupeKey" TEXT;

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "automationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "automationLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "automationLeaseToken" VARCHAR(64),
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "SimulationEvaluatorTask_dedupeKey_key" ON "SimulationEvaluatorTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "SimulationResearch_status_nextRetryAt_idx" ON "SimulationResearch"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SimulationResearch_automationEnabled_status_nextRetryAt_idx" ON "SimulationResearch"("automationEnabled", "status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "SimulationResearch_status_automationLeaseExpiresAt_idx" ON "SimulationResearch"("status", "automationLeaseExpiresAt");
