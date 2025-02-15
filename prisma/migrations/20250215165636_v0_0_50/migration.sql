/*
  Warnings:

  - A unique constraint covering the columns `[address,dateStr,kind]` on the table `PnlSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshot_address_dateStr_kind_key" ON "PnlSnapshot"("address", "dateStr", "kind");
