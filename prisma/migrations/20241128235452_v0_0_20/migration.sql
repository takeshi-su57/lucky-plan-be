/*
  Warnings:

  - A unique constraint covering the columns `[contractId,address,index]` on the table `Position` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Position_address_index_key";

-- CreateIndex
CREATE UNIQUE INDEX "Position_contractId_address_index_key" ON "Position"("contractId", "address", "index");
