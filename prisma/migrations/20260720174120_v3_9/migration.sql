-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "automationLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "automationLeaseToken" VARCHAR(64);

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "completedPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalPlans" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Simulation_status_automationLeaseExpiresAt_idx" ON "Simulation"("status", "automationLeaseExpiresAt");
