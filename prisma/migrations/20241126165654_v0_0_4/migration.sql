/*
  Warnings:

  - Made the column `maxCollateral` on table `Strategy` required. This step will fail if there are existing NULL values in that column.
  - Made the column `maxGas` on table `Strategy` required. This step will fail if there are existing NULL values in that column.
  - Made the column `minCollateral` on table `Strategy` required. This step will fail if there are existing NULL values in that column.
  - Made the column `minGas` on table `Strategy` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Follower" ALTER COLUMN "ethBalance" SET DEFAULT '0',
ALTER COLUMN "ethBalance" SET DATA TYPE TEXT,
ALTER COLUMN "usdcBalance" SET DEFAULT '0',
ALTER COLUMN "usdcBalance" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Strategy" ALTER COLUMN "maxCollateral" SET NOT NULL,
ALTER COLUMN "maxCollateral" SET DEFAULT '1000000000000',
ALTER COLUMN "maxCollateral" SET DATA TYPE TEXT,
ALTER COLUMN "maxGas" SET NOT NULL,
ALTER COLUMN "maxGas" SET DEFAULT '100000000000000000',
ALTER COLUMN "maxGas" SET DATA TYPE TEXT,
ALTER COLUMN "minCollateral" SET NOT NULL,
ALTER COLUMN "minCollateral" SET DEFAULT '5000000',
ALTER COLUMN "minCollateral" SET DATA TYPE TEXT,
ALTER COLUMN "minGas" SET NOT NULL,
ALTER COLUMN "minGas" SET DEFAULT '100000000000000000',
ALTER COLUMN "minGas" SET DATA TYPE TEXT;
