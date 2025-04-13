/*
  Warnings:

  - You are about to drop the column `recentTradedDay` on the `TestingReport` table. All the data in the column will be lost.
  - Added the required column `recentTradedDays` to the `TestingReport` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestingReport" DROP COLUMN "recentTradedDay",
ADD COLUMN     "recentTradedDays" INTEGER NOT NULL;
