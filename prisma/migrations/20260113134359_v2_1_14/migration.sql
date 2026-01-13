-- DropIndex
DROP INDEX "PerpTradingEventLog_platform_contractId_date_block_id_idx";

-- CreateIndex
CREATE INDEX "PerpTradingEventLog_platform_address_date_block_id_idx" ON "PerpTradingEventLog"("platform", "address", "date", "block", "id");

-- CreateIndex
CREATE INDEX "PerpTradingEventLog_platform_date_block_id_idx" ON "PerpTradingEventLog"("platform", "date", "block", "id");
