/*
  Warnings:

  - You are about to drop the column `closePositionCountsByPnlSnapshotKind` on the `TestingReport` table. All the data in the column will be lost.
  - You are about to drop the column `maxR2` on the `TestingReport` table. All the data in the column will be lost.
  - You are about to drop the column `maxSlope` on the `TestingReport` table. All the data in the column will be lost.
  - You are about to drop the column `minSlope` on the `TestingReport` table. All the data in the column will be lost.
  - You are about to drop the column `recentTradedDays` on the `TestingReport` table. All the data in the column will be lost.
  - You are about to drop the `TestingReportV2` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TestingReportV3` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TestingReportV4` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TestingReportV5` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `allTimeWeight` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `m` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxAvgSize` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxCount` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minAvgSize` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minCount` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minScore` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `monthWeight` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `n` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `threeMonthWeight` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `weekWeight` to the `TestingReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `window` to the `TestingReport` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestingReport" DROP COLUMN "closePositionCountsByPnlSnapshotKind",
DROP COLUMN "maxR2",
DROP COLUMN "maxSlope",
DROP COLUMN "minSlope",
DROP COLUMN "recentTradedDays",
ADD COLUMN     "allTimeWeight" INTEGER NOT NULL,
ADD COLUMN     "m" INTEGER NOT NULL,
ADD COLUMN     "maxAvgSize" INTEGER NOT NULL,
ADD COLUMN     "maxCount" INTEGER NOT NULL,
ADD COLUMN     "minAvgSize" INTEGER NOT NULL,
ADD COLUMN     "minCount" INTEGER NOT NULL,
ADD COLUMN     "minScore" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "monthWeight" INTEGER NOT NULL,
ADD COLUMN     "n" INTEGER NOT NULL,
ADD COLUMN     "threeMonthWeight" INTEGER NOT NULL,
ADD COLUMN     "weekWeight" INTEGER NOT NULL,
ADD COLUMN     "window" INTEGER NOT NULL;

-- DropTable
DROP TABLE "TestingReportV2";

-- DropTable
DROP TABLE "TestingReportV3";

-- DropTable
DROP TABLE "TestingReportV4";

-- DropTable
DROP TABLE "TestingReportV5";
