/*
  Warnings:

  - The `leverageDelta` column on the `TradeHistory` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "TradeHistory" DROP COLUMN "leverageDelta",
ADD COLUMN     "leverageDelta" INTEGER;
