-- DropIndex
DROP INDEX "PnlSnapshotV2_accUSDPnl_idx";

-- DropIndex
DROP INDEX "PnlSnapshotV2_platform_idx";

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_dateStr_platform_kind_accUSDPnl_id_idx" ON "PnlSnapshotV2"("dateStr", "platform", "kind", "accUSDPnl" DESC, "id" ASC);

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_platform_kind_accUSDPnl_id_idx" ON "PnlSnapshotV2"("platform", "kind", "accUSDPnl" DESC, "id" ASC);

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_dateStr_platform_idx" ON "PnlSnapshotV2"("dateStr", "platform");
