-- DropIndex
DROP INDEX "PnlSnapshotV2_dateStr_platform_kind_accUSDPnl_idx";

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_dateStr_platform_kind_address_accUSDPnl_idx" ON "PnlSnapshotV2"("dateStr", "platform", "kind", "address", "accUSDPnl" DESC);
