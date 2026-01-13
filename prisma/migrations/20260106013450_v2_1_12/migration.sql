-- CreateEnum
CREATE TYPE "BacktestTaskStatus" AS ENUM ('AWAIT', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BacktestTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "optimizationParams" JSONB NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "interval" TEXT NOT NULL DEFAULT '1m',
    "status" "BacktestTaskStatus" NOT NULL DEFAULT 'AWAIT',
    "totalConfigs" INTEGER NOT NULL DEFAULT 0,
    "processedConfigs" INTEGER NOT NULL DEFAULT 0,
    "currentConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "BacktestTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestResult" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "strategyConfig" JSONB NOT NULL,
    "totalTrades" INTEGER NOT NULL,
    "winningTrades" INTEGER NOT NULL,
    "losingTrades" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "totalPnlUsdt" DOUBLE PRECISION NOT NULL,
    "totalPnlPercent" DOUBLE PRECISION NOT NULL,
    "maxDrawdownUsdt" DOUBLE PRECISION NOT NULL,
    "maxDrawdownPercent" DOUBLE PRECISION NOT NULL,
    "sharpeRatio" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "resultFolder" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacktestTask_status_createdAt_idx" ON "BacktestTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestTask_symbol_idx" ON "BacktestTask"("symbol");

-- CreateIndex
CREATE INDEX "BacktestResult_taskId_runDate_idx" ON "BacktestResult"("taskId", "runDate");

-- CreateIndex
CREATE INDEX "BacktestResult_taskId_totalPnlUsdt_idx" ON "BacktestResult"("taskId", "totalPnlUsdt");

-- CreateIndex
CREATE INDEX "BacktestResult_taskId_winRate_idx" ON "BacktestResult"("taskId", "winRate");

-- AddForeignKey
ALTER TABLE "BacktestResult" ADD CONSTRAINT "BacktestResult_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "BacktestTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
