/*
  Warnings:

  - A unique constraint covering the columns `[address,contractId,block,logIndex]` on the table `PerpTradingEventLog` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PerpTradingEventLog_contractId_block_logIndex_key";

-- CreateIndex
CREATE INDEX "PerpTradingEventLog_platform_contractId_date_block_id_idx" ON "PerpTradingEventLog"("platform", "contractId", "date" ASC, "block" ASC, "id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PerpTradingEventLog_address_contractId_block_logIndex_key" ON "PerpTradingEventLog"("address", "contractId", "block", "logIndex");

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_dateStr_platform_id_idx" ON "PnlSnapshotV2"("dateStr", "platform", "id");
