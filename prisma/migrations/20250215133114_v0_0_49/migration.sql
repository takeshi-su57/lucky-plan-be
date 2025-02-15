/*
  Warnings:

  - The values [TWO_MONTH,TWO_YEAR] on the enum `PnlSnapshotKind` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `contractId` on the `PnlSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `blockNumber` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `eventName` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `in` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `out` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `pairIndex` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `TradeHistory` table. All the data in the column will be lost.
  - Added the required column `dateStr` to the `PnlSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `action` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `block` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collateralIndex` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collateralPriceUsd` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `date` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `leverage` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `long` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pair` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `price` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `size` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tradeIndex` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TradeActionType" AS ENUM ('TradeOpenedMarket', 'TradeOpenedLimit', 'TradeClosedMarket', 'TradeClosedLIQ', 'TradeClosedSL', 'TradeClosedTP', 'TradeLeverageUpdate', 'TradePosSizeIncrease', 'TradePosSizeDecrease');

-- AlterEnum
BEGIN;
CREATE TYPE "PnlSnapshotKind_new" AS ENUM ('DAY', 'TWO_DAY', 'THREE_DAY', 'WEEK', 'TWO_WEEK', 'MONTH', 'THREE_MONTH', 'HALF_YEAR', 'YEAR', 'ALL_TIME');
ALTER TABLE "PnlSnapshot" ALTER COLUMN "kind" TYPE "PnlSnapshotKind_new" USING ("kind"::text::"PnlSnapshotKind_new");
ALTER TYPE "PnlSnapshotKind" RENAME TO "PnlSnapshotKind_old";
ALTER TYPE "PnlSnapshotKind_new" RENAME TO "PnlSnapshotKind";
DROP TYPE "PnlSnapshotKind_old";
COMMIT;

-- DropIndex
DROP INDEX "PnlSnapshot_address_contractId_kind_accUSDPnl_idx";

-- DropIndex
DROP INDEX "PnlSnapshot_address_contractId_kind_key";

-- DropIndex
DROP INDEX "TradeHistory_address_contractId_blockNumber_idx";

-- DropIndex
DROP INDEX "TradeHistory_address_contractId_timestamp_idx";

-- AlterTable
ALTER TABLE "PnlSnapshot" DROP COLUMN "contractId",
ADD COLUMN     "dateStr" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TradeHistory" DROP COLUMN "blockNumber",
DROP COLUMN "eventName",
DROP COLUMN "in",
DROP COLUMN "out",
DROP COLUMN "pairIndex",
DROP COLUMN "timestamp",
ADD COLUMN     "action" "TradeActionType" NOT NULL,
ADD COLUMN     "block" INTEGER NOT NULL,
ADD COLUMN     "collateralDelta" INTEGER,
ADD COLUMN     "collateralIndex" INTEGER NOT NULL,
ADD COLUMN     "collateralPriceUsd" INTEGER NOT NULL,
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "leverage" INTEGER NOT NULL,
ADD COLUMN     "leverageDelta" INTEGER,
ADD COLUMN     "long" INTEGER NOT NULL,
ADD COLUMN     "marketPrice" INTEGER,
ADD COLUMN     "pair" TEXT NOT NULL,
ADD COLUMN     "price" INTEGER NOT NULL,
ADD COLUMN     "size" INTEGER NOT NULL,
ADD COLUMN     "tradeId" TEXT,
ADD COLUMN     "tradeIndex" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "PnlSnapshotInitializedFlag" (
    "id" SERIAL NOT NULL,
    "dateStr" TEXT NOT NULL,
    "isInit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PnlSnapshotInitializedFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeHistory_address_contractId_block_idx" ON "TradeHistory"("address", "contractId", "block" ASC);
