/*
  Warnings:

  - Added the required column `maxAvgSize` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxCount` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minAvgSize` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minCount` to the `TestingReportV5` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestingReportV5" ADD COLUMN     "maxAvgSize" INTEGER NOT NULL,
ADD COLUMN     "maxCount" INTEGER NOT NULL,
ADD COLUMN     "minAvgSize" INTEGER NOT NULL,
ADD COLUMN     "minCount" INTEGER NOT NULL;
