/*
  Warnings:

  - A unique constraint covering the columns `[address]` on the table `Account` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `address` to the `Account` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "address" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Account_address_key" ON "Account"("address");
