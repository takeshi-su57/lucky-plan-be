/*
  Warnings:

  - Added the required column `address` to the `PerpTradingEventLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PerpTradingEventLog" ADD COLUMN     "address" TEXT NOT NULL;
