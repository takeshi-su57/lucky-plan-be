/*
  Warnings:

  - You are about to drop the column `closeFeeRate` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `maxCollateralUsd` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `maxRatio` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `minCollateralUsd` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `minRatio` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `openFeeRate` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `slippageRate` on the `Simulation` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Simulation" DROP COLUMN "closeFeeRate",
DROP COLUMN "maxCollateralUsd",
DROP COLUMN "maxRatio",
DROP COLUMN "minCollateralUsd",
DROP COLUMN "minRatio",
DROP COLUMN "openFeeRate",
DROP COLUMN "slippageRate";
