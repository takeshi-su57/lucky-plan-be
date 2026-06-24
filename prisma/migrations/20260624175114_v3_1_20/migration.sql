-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('Created', 'Running', 'Paused', 'Completed', 'Failed', 'Cancelled');

-- AlterTable
ALTER TABLE "SimulationPlan" ADD COLUMN     "simulationId" INTEGER;

-- CreateTable
CREATE TABLE "Simulation" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "cursor" TIMESTAMP(3),
    "status" "SimulationStatus" NOT NULL DEFAULT 'Created',
    "progressPhase" TEXT,
    "progressMessage" TEXT,
    "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selectedLeaderCount" INTEGER NOT NULL DEFAULT 10,
    "minTrades" INTEGER NOT NULL DEFAULT 3,
    "minNegativeR2" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "standardCollateralUsd" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "minCollateralUsd" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "maxCollateralUsd" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "minRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "maxRatio" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "maxLeverage" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "openFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closeFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slippageRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSimulationPlans" INTEGER NOT NULL DEFAULT 0,
    "completedPlans" INTEGER NOT NULL DEFAULT 0,
    "totalLeaderPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFollowerPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalNetPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDrawdownUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationLeaderSelection" (
    "id" SERIAL NOT NULL,
    "simulationId" INTEGER NOT NULL,
    "simulationPlanId" INTEGER,
    "leaderAddress" VARCHAR(255) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggestedCollateralUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawTotalPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawSlope" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawR2" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawTradeCount" INTEGER NOT NULL DEFAULT 0,
    "reverseNetPnlUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reverseDrawdownUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationLeaderSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Simulation_status_createdAt_idx" ON "Simulation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Simulation_platform_startAt_endAt_idx" ON "Simulation"("platform", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "SimulationLeaderSelection_simulationId_date_idx" ON "SimulationLeaderSelection"("simulationId", "date");

-- CreateIndex
CREATE INDEX "SimulationLeaderSelection_leaderAddress_idx" ON "SimulationLeaderSelection"("leaderAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationLeaderSelection_simulationPlanId_leaderAddress_key" ON "SimulationLeaderSelection"("simulationPlanId", "leaderAddress");

-- CreateIndex
CREATE INDEX "SimulationPlan_simulationId_startAt_idx" ON "SimulationPlan"("simulationId", "startAt");

-- AddForeignKey
ALTER TABLE "SimulationPlan" ADD CONSTRAINT "SimulationPlan_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationLeaderSelection" ADD CONSTRAINT "SimulationLeaderSelection_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationLeaderSelection" ADD CONSTRAINT "SimulationLeaderSelection_simulationPlanId_fkey" FOREIGN KEY ("simulationPlanId") REFERENCES "SimulationPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
