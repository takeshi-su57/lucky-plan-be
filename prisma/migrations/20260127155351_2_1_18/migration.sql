-- CreateEnum
CREATE TYPE "StrategyCategory" AS ENUM ('TREND_FOLLOWING', 'MEAN_REVERSION', 'BREAKOUT', 'MOMENTUM', 'VOLATILITY', 'SCALPING', 'SWING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TemplateSearchStatus" AS ENUM ('AWAIT', 'PROCESSING', 'DONE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "BacktestTask" ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateSearchId" TEXT;

-- CreateTable
CREATE TABLE "StrategyTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "StrategyCategory" NOT NULL,
    "factoryConfig" JSONB NOT NULL,
    "defaultSymbols" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "symbols" TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "interval" TEXT NOT NULL DEFAULT '1m',
    "searchStrategy" TEXT NOT NULL DEFAULT 'framework',
    "status" "TemplateSearchStatus" NOT NULL DEFAULT 'AWAIT',
    "totalSymbols" INTEGER NOT NULL DEFAULT 0,
    "processedSymbols" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "TemplateSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyTemplate_name_key" ON "StrategyTemplate"("name");

-- CreateIndex
CREATE INDEX "StrategyTemplate_category_idx" ON "StrategyTemplate"("category");

-- CreateIndex
CREATE INDEX "StrategyTemplate_isActive_idx" ON "StrategyTemplate"("isActive");

-- CreateIndex
CREATE INDEX "TemplateSearch_status_createdAt_idx" ON "TemplateSearch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TemplateSearch_templateId_idx" ON "TemplateSearch"("templateId");

-- CreateIndex
CREATE INDEX "BacktestTask_templateSearchId_idx" ON "BacktestTask"("templateSearchId");

-- CreateIndex
CREATE INDEX "BacktestTask_templateId_idx" ON "BacktestTask"("templateId");

-- AddForeignKey
ALTER TABLE "TemplateSearch" ADD CONSTRAINT "TemplateSearch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "StrategyTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestTask" ADD CONSTRAINT "BacktestTask_templateSearchId_fkey" FOREIGN KEY ("templateSearchId") REFERENCES "TemplateSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestTask" ADD CONSTRAINT "BacktestTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "StrategyTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
