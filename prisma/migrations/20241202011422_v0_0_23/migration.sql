/*
  Warnings:

  - You are about to drop the column `ethBalance` on the `Follower` table. All the data in the column will be lost.
  - You are about to drop the column `usdcBalance` on the `Follower` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Follower" DROP COLUMN "ethBalance",
DROP COLUMN "usdcBalance";
