/*
  Warnings:

  - Added the required column `lossCount` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `profitCount` to the `TestingReport` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestingReport" ADD COLUMN     "lossCount" INTEGER NOT NULL,
ADD COLUMN     "profitCount" INTEGER NOT NULL;
