-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "sourceSimulationId" INTEGER;

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "leaderExecutionCollateral" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "leaderExecutionLeverage" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "leaderExecutionSize" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "sourceSimulationBotId" INTEGER;

-- AlterTable
ALTER TABLE "SimulationBotCache" ADD COLUMN     "eventSnapshotVersion" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "realizedEquityCurveJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "SimulationPlan" ADD COLUMN     "sourceSimulationPlanId" INTEGER;

-- AlterTable
ALTER TABLE "SimulationPlanCache" ADD COLUMN     "realizedEquityCurveJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "sourceSimulationId" INTEGER;

-- CreateIndex
CREATE INDEX "Simulation_sourceSimulationId_idx" ON "Simulation"("sourceSimulationId");

-- CreateIndex
CREATE INDEX "SimulationBot_sourceSimulationBotId_idx" ON "SimulationBot"("sourceSimulationBotId");

-- CreateIndex
CREATE INDEX "SimulationPlan_sourceSimulationPlanId_idx" ON "SimulationPlan"("sourceSimulationPlanId");

-- CreateIndex
CREATE INDEX "SimulationResearch_sourceSimulationId_idx" ON "SimulationResearch"("sourceSimulationId");

-- AddForeignKey
ALTER TABLE "SimulationPlan" ADD CONSTRAINT "SimulationPlan_sourceSimulationPlanId_fkey" FOREIGN KEY ("sourceSimulationPlanId") REFERENCES "SimulationPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationResearch" ADD CONSTRAINT "SimulationResearch_sourceSimulationId_fkey" FOREIGN KEY ("sourceSimulationId") REFERENCES "Simulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_sourceSimulationId_fkey" FOREIGN KEY ("sourceSimulationId") REFERENCES "Simulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationBot" ADD CONSTRAINT "SimulationBot_sourceSimulationBotId_fkey" FOREIGN KEY ("sourceSimulationBotId") REFERENCES "SimulationBot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
