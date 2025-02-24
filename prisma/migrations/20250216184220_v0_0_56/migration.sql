/*
  Warnings:

  - Made the column `contractId` on table `PnlSnapshot` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "PnlSnapshot" ALTER COLUMN "contractId" SET NOT NULL;
