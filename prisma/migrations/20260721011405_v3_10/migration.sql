-- CreateEnum
CREATE TYPE "SimulationExecutionPlanStatus" AS ENUM ('Pending', 'Dispatched', 'Finalizing', 'Completed', 'Failed', 'Cancelled');

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "finalizingPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outstandingPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "queuedPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runningPlans" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SimulationExecutionPlan" (
    "id" TEXT NOT NULL,
    "simulationId" INTEGER NOT NULL,
    "evaluatorTaskId" TEXT,
    "rangeStartedAt" TIMESTAMP(3) NOT NULL,
    "rangeEndedAt" TIMESTAMP(3) NOT NULL,
    "status" "SimulationExecutionPlanStatus" NOT NULL DEFAULT 'Pending',
    "leaseToken" VARCHAR(64),
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimulationExecutionPlan_evaluatorTaskId_key" ON "SimulationExecutionPlan"("evaluatorTaskId");

-- CreateIndex
CREATE INDEX "SimulationExecutionPlan_status_createdAt_idx" ON "SimulationExecutionPlan"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SimulationExecutionPlan_simulationId_status_idx" ON "SimulationExecutionPlan"("simulationId", "status");

-- CreateIndex
CREATE INDEX "SimulationExecutionPlan_status_leaseExpiresAt_idx" ON "SimulationExecutionPlan"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationExecutionPlan_simulationId_rangeStartedAt_rangeEn_key" ON "SimulationExecutionPlan"("simulationId", "rangeStartedAt", "rangeEndedAt");

-- AddForeignKey
ALTER TABLE "SimulationExecutionPlan" ADD CONSTRAINT "SimulationExecutionPlan_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationExecutionPlan" ADD CONSTRAINT "SimulationExecutionPlan_evaluatorTaskId_fkey" FOREIGN KEY ("evaluatorTaskId") REFERENCES "SimulationEvaluatorTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
