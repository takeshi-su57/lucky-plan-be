/*
  Warnings:

  - A unique constraint covering the columns `[simulationPlanId,leaderAddress,leaderPlatform,mode,ratio,minCollateral,maxCollateral,minSize,maxSize,minLeverage,maxLeverage]` on the table `SimulationBot` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SimulationBot_simulationPlanId_leaderAddress_leaderPlatform_key";

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "followerRiskCollateral" JSONB NOT NULL DEFAULT '{"min":10,"max":100}',
ADD COLUMN     "followerRiskSize" JSONB NOT NULL DEFAULT '{"min":50,"max":500}',
ADD COLUMN     "leaderExecutionCollateral" JSONB NOT NULL DEFAULT '{"min":0,"max":1000000000}',
ADD COLUMN     "leaderExecutionLeverage" JSONB NOT NULL DEFAULT '{"min":0,"max":50}',
ADD COLUMN     "leaderExecutionSize" JSONB NOT NULL DEFAULT '{"min":0,"max":1000000000}';

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "evaluationCopiedPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evaluationMaxDrawdownUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evaluationProfitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evaluationR2" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evaluationSlope" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evaluationTradeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "followerRiskCollateral" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "followerRiskSize" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "maxSize" DOUBLE PRECISION NOT NULL DEFAULT 1000000000,
ADD COLUMN     "minSize" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "followerRiskCollateral" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "followerRiskSize" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "leaderExecutionCollateral" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "leaderExecutionLeverage" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "leaderExecutionSize" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBot_three_layer_execution_key" ON "SimulationBot"("simulationPlanId", "leaderAddress", "leaderPlatform", "mode", "ratio", "minCollateral", "maxCollateral", "minSize", "maxSize", "minLeverage", "maxLeverage");
