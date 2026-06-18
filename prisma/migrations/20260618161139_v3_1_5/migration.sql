/*
  Warnings:

  - You are about to drop the column `isTestnet` on the `Contract` table. All the data in the column will be lost.
  - The primary key for the `PnlSnapshotV2` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `kind` on the `PnlSnapshotV2` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "PnlSnapshotV2_dateStr_platform_kind_address_accUSDPnl_idx";

-- AlterTable
ALTER TABLE "Contract" DROP COLUMN "isTestnet";

-- AlterTable
ALTER TABLE "PnlSnapshotV2" DROP CONSTRAINT "PnlSnapshotV2_pkey",
DROP COLUMN "kind",
ADD CONSTRAINT "PnlSnapshotV2_pkey" PRIMARY KEY ("address", "platform", "dateStr");

-- DropEnum
DROP TYPE "PnlSnapshotKind";

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_dateStr_platform_accUSDPnl_address_idx" ON "PnlSnapshotV2"("dateStr", "platform", "accUSDPnl" DESC, "address" ASC);
