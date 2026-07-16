/*
  Warnings:

  - A unique constraint covering the columns `[workerId,platform,coveredStartAt,coveredEndAt]` on the table `SimulationEvaluatorWorkerPlatformCache` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SimulationEvaluatorWorkerPlatformCache_workerId_platform_key";

-- AlterTable
ALTER TABLE "SimulationEvaluatorTask" ADD COLUMN     "progressTotalRecords" BIGINT NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "SimulationEvaluatorWorkerPlatformCache_workerId_platform_co_key" ON "SimulationEvaluatorWorkerPlatformCache"("workerId", "platform", "coveredStartAt", "coveredEndAt");
