/*
  Warnings:

  - The primary key for the `_TagToWalletAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[A,B]` on the table `_TagToWalletAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_AB_pkey";

-- CreateTable
CREATE TABLE "TestingReport" (
    "id" SERIAL NOT NULL,
    "minSlope" INTEGER NOT NULL,
    "maxSlope" INTEGER NOT NULL,
    "minR2" DOUBLE PRECISION NOT NULL,
    "maxR2" DOUBLE PRECISION NOT NULL,
    "recentTradedDay" INTEGER NOT NULL,
    "closePositionCountsByPnlSnapshotKind" TEXT NOT NULL,
    "investedUSD" DOUBLE PRECISION NOT NULL,
    "totalUSDPnl" DOUBLE PRECISION NOT NULL,
    "totalTasks" INTEGER NOT NULL,
    "totalPositions" INTEGER NOT NULL,
    "totalTraders" INTEGER NOT NULL,
    "totalUniqueTraders" INTEGER NOT NULL,
    "accUSDPnls" DOUBLE PRECISION[],
    "calculatedR2" DOUBLE PRECISION NOT NULL,
    "calculatedSlope" DOUBLE PRECISION NOT NULL,
    "maxLoss" DOUBLE PRECISION NOT NULL,
    "avgLoss" DOUBLE PRECISION NOT NULL,
    "maxProfit" DOUBLE PRECISION NOT NULL,
    "avgProfit" DOUBLE PRECISION NOT NULL,
    "peakAccProfit" DOUBLE PRECISION NOT NULL,
    "bottomAccProfit" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TestingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "_TagToWalletAccount_AB_unique" ON "_TagToWalletAccount"("A", "B");
