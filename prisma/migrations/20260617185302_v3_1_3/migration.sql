/*
  Warnings:

  - The primary key for the `PnlSnapshotV2` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `PnlSnapshotV2` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "PnlSnapshotV2_address_platform_dateStr_kind_key";

-- DropIndex
DROP INDEX "PnlSnapshotV2_dateStr_platform_id_idx";

-- DropIndex
DROP INDEX "PnlSnapshotV2_dateStr_platform_idx";

-- DropIndex
DROP INDEX "PnlSnapshotV2_dateStr_platform_kind_accUSDPnl_id_idx";

-- DropIndex
DROP INDEX "PnlSnapshotV2_platform_kind_accUSDPnl_id_idx";

-- AlterTable
ALTER TABLE "PnlSnapshotV2" DROP CONSTRAINT "PnlSnapshotV2_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "PnlSnapshotV2_pkey" PRIMARY KEY ("address", "platform", "dateStr", "kind");

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_dateStr_platform_kind_accUSDPnl_idx" ON "PnlSnapshotV2"("dateStr", "platform", "kind", "accUSDPnl" DESC);
