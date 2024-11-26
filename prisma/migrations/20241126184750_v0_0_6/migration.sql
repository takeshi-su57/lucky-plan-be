/*
  Warnings:

  - Made the column `maxLeverage` on table `Strategy` required. This step will fail if there are existing NULL values in that column.
  - Made the column `minLeverage` on table `Strategy` required. This step will fail if there are existing NULL values in that column.
  - Made the column `ratio` on table `Strategy` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN     "lifeTime" BIGINT NOT NULL DEFAULT 31536000000,
ALTER COLUMN "maxLeverage" SET NOT NULL,
ALTER COLUMN "minLeverage" SET NOT NULL,
ALTER COLUMN "ratio" SET NOT NULL;
