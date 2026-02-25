/*
  Warnings:

  - You are about to drop the column `defaultSymbols` on the `StrategyTemplate` table. All the data in the column will be lost.
  - You are about to drop the column `processedSymbols` on the `TemplateSearch` table. All the data in the column will be lost.
  - You are about to drop the column `symbols` on the `TemplateSearch` table. All the data in the column will be lost.
  - You are about to drop the column `totalSymbols` on the `TemplateSearch` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[templateSearchId]` on the table `BacktestTask` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `symbol` to the `TemplateSearch` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "BacktestTask_templateSearchId_idx";

-- AlterTable
ALTER TABLE "StrategyTemplate" DROP COLUMN "defaultSymbols";

-- AlterTable
ALTER TABLE "TemplateSearch" DROP COLUMN "processedSymbols",
DROP COLUMN "symbols",
DROP COLUMN "totalSymbols",
ADD COLUMN     "symbol" TEXT NOT NULL,
ALTER COLUMN "searchStrategy" SET DEFAULT 'optuna';

-- CreateIndex
CREATE UNIQUE INDEX "BacktestTask_templateSearchId_key" ON "BacktestTask"("templateSearchId");

-- CreateIndex
CREATE INDEX "TemplateSearch_symbol_idx" ON "TemplateSearch"("symbol");
