/*
  Warnings:

  - A unique constraint covering the columns `[address,contractId,dateStr,kind]` on the table `PnlSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PnlSnapshot_address_dateStr_kind_key";

-- AlterTable
ALTER TABLE "PnlSnapshot" ADD COLUMN     "contractId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshot_address_contractId_dateStr_kind_key" ON "PnlSnapshot"("address", "contractId", "dateStr", "kind");
