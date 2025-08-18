/*
  Warnings:

  - Added the required column `platform` to the `PerpTradingEventLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PerpTradingEventLog" ADD COLUMN     "platform" "Platform" NOT NULL;
