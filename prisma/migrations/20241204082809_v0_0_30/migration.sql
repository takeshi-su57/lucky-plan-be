/*
  Warnings:

  - You are about to drop the column `leaderAvgUSDCollateral` on the `Bot` table. All the data in the column will be lost.
  - Added the required column `leaderCollateralBaseline` to the `Bot` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "leaderAvgUSDCollateral",
ADD COLUMN     "leaderCollateralBaseline" INTEGER NOT NULL;
