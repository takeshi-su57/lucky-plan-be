/*
  Warnings:

  - A unique constraint covering the columns `[simulationPlanId,leaderAddress,leaderPlatform,mode,ratio,minCollateral,maxCollateral,minLeverage,maxLeverage]` on the table `SimulationBot` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SimulationBot_simulationPlanId_leaderAddress_leaderPlatform_key";

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "collateral" JSONB NOT NULL DEFAULT '{"min":0,"max":1000000000}';

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "maxCollateral" DOUBLE PRECISION NOT NULL DEFAULT 1000000000,
ADD COLUMN     "minCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "collateral" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBot_simulationPlanId_leaderAddress_leaderPlatform_key" ON "SimulationBot"("simulationPlanId", "leaderAddress", "leaderPlatform", "mode", "ratio", "minCollateral", "maxCollateral", "minLeverage", "maxLeverage");
