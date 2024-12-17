/*
  Warnings:

  - You are about to drop the column `collateralIn` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `collateralOut` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `collateralPnl` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `usdIn` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `usdOut` on the `TradeHistory` table. All the data in the column will be lost.
  - You are about to drop the column `usdPnl` on the `TradeHistory` table. All the data in the column will be lost.
  - Added the required column `in` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `out` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `pnl` to the `TradeHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TradeHistory" DROP COLUMN "collateralIn",
DROP COLUMN "collateralOut",
DROP COLUMN "collateralPnl",
DROP COLUMN "usdIn",
DROP COLUMN "usdOut",
DROP COLUMN "usdPnl",
ADD COLUMN     "in" INTEGER NOT NULL,
ADD COLUMN     "out" INTEGER NOT NULL,
ADD COLUMN     "pnl" INTEGER NOT NULL;
