/*
  Warnings:

  - You are about to drop the `BacktestResult` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BacktestTask` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `EventLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JupPerpEventLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ParetoStep` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PnlSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PnlSnapshotInitializedFlag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StrategyTemplate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Tag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TagCategory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TemplateSearch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TestingReport` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ThresholdStep` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TradeHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ValidationCandidate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ValidationPipeline` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WalletAccount` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_TagToWalletAccount` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BacktestResult" DROP CONSTRAINT "BacktestResult_taskId_fkey";

-- DropForeignKey
ALTER TABLE "BacktestTask" DROP CONSTRAINT "BacktestTask_templateId_fkey";

-- DropForeignKey
ALTER TABLE "BacktestTask" DROP CONSTRAINT "BacktestTask_templateSearchId_fkey";

-- DropForeignKey
ALTER TABLE "ParetoStep" DROP CONSTRAINT "ParetoStep_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "TemplateSearch" DROP CONSTRAINT "TemplateSearch_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ThresholdStep" DROP CONSTRAINT "ThresholdStep_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "ValidationCandidate" DROP CONSTRAINT "ValidationCandidate_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "ValidationCandidate" DROP CONSTRAINT "ValidationCandidate_resultId_fkey";

-- DropForeignKey
ALTER TABLE "ValidationPipeline" DROP CONSTRAINT "ValidationPipeline_backtestTaskId_fkey";

-- DropForeignKey
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_A_fkey";

-- DropForeignKey
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_B_fkey";

-- DropTable
DROP TABLE "BacktestResult";

-- DropTable
DROP TABLE "BacktestTask";

-- DropTable
DROP TABLE "EventLog";

-- DropTable
DROP TABLE "JupPerpEventLog";

-- DropTable
DROP TABLE "ParetoStep";

-- DropTable
DROP TABLE "PnlSnapshot";

-- DropTable
DROP TABLE "PnlSnapshotInitializedFlag";

-- DropTable
DROP TABLE "StrategyTemplate";

-- DropTable
DROP TABLE "Tag";

-- DropTable
DROP TABLE "TagCategory";

-- DropTable
DROP TABLE "TemplateSearch";

-- DropTable
DROP TABLE "TestingReport";

-- DropTable
DROP TABLE "ThresholdStep";

-- DropTable
DROP TABLE "TradeHistory";

-- DropTable
DROP TABLE "ValidationCandidate";

-- DropTable
DROP TABLE "ValidationPipeline";

-- DropTable
DROP TABLE "WalletAccount";

-- DropTable
DROP TABLE "_TagToWalletAccount";

-- DropEnum
DROP TYPE "BacktestTaskStatus";

-- DropEnum
DROP TYPE "StrategyCategory";

-- DropEnum
DROP TYPE "TemplateSearchStatus";

-- DropEnum
DROP TYPE "ValidationCandidateStatus";

-- DropEnum
DROP TYPE "ValidationPipelineStatus";
