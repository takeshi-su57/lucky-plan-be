-- CreateTable
CREATE TABLE "SimulationBotCache" (
    "id" SERIAL NOT NULL,
    "simulationBotId" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "rebuilding" BOOLEAN NOT NULL DEFAULT false,
    "rebuildRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastFetchedAt" TIMESTAMP(3),
    "openedPositions" INTEGER NOT NULL DEFAULT 0,
    "totalPositions" INTEGER NOT NULL DEFAULT 0,
    "totalLeaderPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFollowerPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPositivePnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgNegativePnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPnlPercentageBySize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPnlPercentageByCollateral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLeverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationBotCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationBotCachedEventLog" (
    "id" SERIAL NOT NULL,
    "simulationBotCacheId" INTEGER NOT NULL,
    "sourceEventLogId" INTEGER NOT NULL,
    "contractId" INTEGER NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "platform" "Platform" NOT NULL,
    "block" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "jsonLog" TEXT NOT NULL,
    "usdPnl" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationBotCachedEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationPlanCache" (
    "id" SERIAL NOT NULL,
    "simulationPlanId" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "rebuilding" BOOLEAN NOT NULL DEFAULT false,
    "completedBots" INTEGER NOT NULL DEFAULT 0,
    "incompleteBots" INTEGER NOT NULL DEFAULT 0,
    "openedPositions" INTEGER NOT NULL DEFAULT 0,
    "totalPositions" INTEGER NOT NULL DEFAULT 0,
    "totalLeaderPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFollowerPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastBuiltAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationPlanCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBotCache_simulationBotId_key" ON "SimulationBotCache"("simulationBotId");

-- CreateIndex
CREATE INDEX "SimulationBotCachedEventLog_simulationBotCacheId_date_block_idx" ON "SimulationBotCachedEventLog"("simulationBotCacheId", "date", "block", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBotCachedEventLog_simulationBotCacheId_sourceEven_key" ON "SimulationBotCachedEventLog"("simulationBotCacheId", "sourceEventLogId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationPlanCache_simulationPlanId_key" ON "SimulationPlanCache"("simulationPlanId");

-- AddForeignKey
ALTER TABLE "SimulationBotCache" ADD CONSTRAINT "SimulationBotCache_simulationBotId_fkey" FOREIGN KEY ("simulationBotId") REFERENCES "SimulationBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationBotCachedEventLog" ADD CONSTRAINT "SimulationBotCachedEventLog_simulationBotCacheId_fkey" FOREIGN KEY ("simulationBotCacheId") REFERENCES "SimulationBotCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationPlanCache" ADD CONSTRAINT "SimulationPlanCache_simulationPlanId_fkey" FOREIGN KEY ("simulationPlanId") REFERENCES "SimulationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
