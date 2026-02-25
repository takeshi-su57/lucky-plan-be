/*
  Warnings:

  - You are about to drop the column `bestParams` on the `BacktestTask` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BacktestTask" DROP COLUMN "bestParams",
ADD COLUMN     "bestConfigId" TEXT;
