/*
  Warnings:

  - You are about to drop the column `bestConfigId` on the `BacktestTask` table. All the data in the column will be lost.
  - You are about to drop the column `direction` on the `BacktestTask` table. All the data in the column will be lost.
  - You are about to drop the column `optimizationMetric` on the `BacktestTask` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BacktestTask" DROP COLUMN "bestConfigId",
DROP COLUMN "direction",
DROP COLUMN "optimizationMetric",
ADD COLUMN     "bestConfigIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "optimizationMetrics" TEXT[] DEFAULT ARRAY['sharpeRatio']::TEXT[];
