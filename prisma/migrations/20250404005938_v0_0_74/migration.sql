/*
  Warnings:

  - You are about to drop the column `accUSDPnls` on the `TestingReport` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TestingReport" DROP COLUMN "accUSDPnls",
ADD COLUMN     "usdPnls" DOUBLE PRECISION[];
