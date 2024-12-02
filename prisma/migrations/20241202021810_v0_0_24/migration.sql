/*
  Warnings:

  - You are about to drop the column `maxGas` on the `Strategy` table. All the data in the column will be lost.
  - You are about to drop the column `minGas` on the `Strategy` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Strategy" DROP COLUMN "maxGas",
DROP COLUMN "minGas";
