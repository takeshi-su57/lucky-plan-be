/*
  Warnings:

  - You are about to drop the column `contractId` on the `PnlSnapshotV2` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `PnlSnapshotV2` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[address,platform,dateStr,kind]` on the table `PnlSnapshotV2` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PnlSnapshotV2_address_contractId_dateStr_kind_key";

-- AlterTable
ALTER TABLE "PnlSnapshotV2" DROP COLUMN "contractId",
DROP COLUMN "version";

-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshotV2_address_platform_dateStr_kind_key" ON "PnlSnapshotV2"("address", "platform", "dateStr", "kind");
