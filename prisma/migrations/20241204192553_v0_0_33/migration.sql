-- CreateIndex
CREATE INDEX "TradeHistory_address_contractId_timestamp_idx" ON "TradeHistory"("address", "contractId", "timestamp" ASC);
