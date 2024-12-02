/*
  Warnings:

  - Added the required column `maxCapacity` to the `Strategy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `minCapacity` to the `Strategy` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `maxCollateral` on the `Strategy` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `minCollateral` on the `Strategy` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `lifeTime` on the `Strategy` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Strategy" ADD COLUMN     "maxCapacity" INTEGER NOT NULL,
ADD COLUMN     "minCapacity" INTEGER NOT NULL,
DROP COLUMN "maxCollateral",
ADD COLUMN     "maxCollateral" INTEGER NOT NULL,
DROP COLUMN "minCollateral",
ADD COLUMN     "minCollateral" INTEGER NOT NULL,
DROP COLUMN "lifeTime",
ADD COLUMN     "lifeTime" INTEGER NOT NULL;
