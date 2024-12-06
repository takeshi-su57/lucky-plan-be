/*
  Warnings:

  - Added the required column `eventName` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TradeHistory" ADD COLUMN     "eventName" TEXT NOT NULL;
