/*
  Warnings:

  - The primary key for the `PerpTradingEventLog` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `PerpTradingEventLog` table. All the data in the column will be lost.
  - You are about to drop the column `sourceEventLogId` on the `SimulationBotCachedEventLog` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[simulationBotCacheId,sourceEventLogKey]` on the table `SimulationBotCachedEventLog` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `transactionHash` to the `PerpTradingEventLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sourceEventLogKey` to the `SimulationBotCachedEventLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transactionHash` to the `SimulationBotCachedEventLog` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "PerpTradingEventLog_address_contractId_block_logIndex_key";

-- DropIndex
DROP INDEX "PerpTradingEventLog_platform_address_date_block_id_idx";

-- DropIndex
DROP INDEX "PerpTradingEventLog_platform_date_block_id_idx";

-- DropIndex
DROP INDEX "SimulationBotCachedEventLog_simulationBotCacheId_date_block_idx";

-- DropIndex
DROP INDEX "SimulationBotCachedEventLog_simulationBotCacheId_sourceEven_key";

-- AlterTable
ALTER TABLE "PerpTradingEventLog" DROP CONSTRAINT "PerpTradingEventLog_pkey",
DROP COLUMN "id",
ADD COLUMN     "transactionHash" TEXT NOT NULL,
ADD CONSTRAINT "PerpTradingEventLog_pkey" PRIMARY KEY ("contractId", "block", "logIndex");

-- AlterTable
ALTER TABLE "SimulationBotCachedEventLog" DROP COLUMN "sourceEventLogId",
ADD COLUMN     "sourceEventLogKey" VARCHAR(255) NOT NULL,
ADD COLUMN     "transactionHash" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "PerpTradingEventLog_platform_address_date_block_logIndex_co_idx" ON "PerpTradingEventLog"("platform", "address", "date", "block", "logIndex", "contractId");

-- CreateIndex
CREATE INDEX "PerpTradingEventLog_platform_date_block_logIndex_contractId_idx" ON "PerpTradingEventLog"("platform", "date", "block", "logIndex", "contractId");

-- CreateIndex
CREATE INDEX "SimulationBotCachedEventLog_simulationBotCacheId_date_block_idx" ON "SimulationBotCachedEventLog"("simulationBotCacheId", "date", "block", "logIndex", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBotCachedEventLog_simulationBotCacheId_sourceEven_key" ON "SimulationBotCachedEventLog"("simulationBotCacheId", "sourceEventLogKey");
