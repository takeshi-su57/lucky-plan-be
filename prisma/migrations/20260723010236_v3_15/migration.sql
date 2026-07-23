-- AlterEnum
ALTER TYPE "SimulationExecutionPlanStatus" ADD VALUE 'AwaitingEventLogs';

-- AlterTable
ALTER TABLE "SimulationExecutionPlan" ADD COLUMN     "nextFinalizationAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SimulationExecutionPlan_status_nextFinalizationAt_idx" ON "SimulationExecutionPlan"("status", "nextFinalizationAt");
