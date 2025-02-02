/*
  Warnings:

  - You are about to drop the column `maxCapacity` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `minCapacity` on the `Strategy` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Strategy" DROP COLUMN "maxCapacity",
DROP COLUMN "minCapacity";
