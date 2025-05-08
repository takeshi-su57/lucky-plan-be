/*
  Warnings:

  - Added the required column `allTimeWeight` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.
  - Added the required column `monthWeight` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.
  - Added the required column `threeMonthWeight` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.
  - Added the required column `weekWeight` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestingReportV5" ADD COLUMN     "allTimeWeight" INTEGER NOT NULL,
ADD COLUMN     "monthWeight" INTEGER NOT NULL,
ADD COLUMN     "threeMonthWeight" INTEGER NOT NULL,
ADD COLUMN     "weekWeight" INTEGER NOT NULL;
