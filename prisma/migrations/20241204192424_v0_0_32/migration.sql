-- CreateEnum
CREATE TYPE "PnlSnapshotKind" AS ENUM ('DAY', 'WEEK', 'TWO_WEEK', 'MONTH', 'TWO_MONTH', 'THREE_MONTH', 'HALF_YEAR', 'YEAR', 'TWO_YEAR', 'ALL_TIME');

-- CreateTable
CREATE TABLE "TradeHistory" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "contractId" INTEGER NOT NULL,
    "collateralIn" INTEGER NOT NULL,
    "collateralOut" INTEGER NOT NULL,
    "collateralPnl" INTEGER NOT NULL,
    "usdIn" INTEGER NOT NULL,
    "usdOut" INTEGER NOT NULL,
    "usdPnl" INTEGER NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnlSnapshot" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "contractId" INTEGER NOT NULL,
    "kind" "PnlSnapshotKind" NOT NULL,
    "accUSDPnl" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PnlSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeHistory_address_contractId_blockNumber_idx" ON "TradeHistory"("address", "contractId", "blockNumber" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TradeHistory_address_contractId_key" ON "TradeHistory"("address", "contractId");

-- CreateIndex
CREATE INDEX "PnlSnapshot_address_contractId_kind_accUSDPnl_idx" ON "PnlSnapshot"("address", "contractId", "kind", "accUSDPnl" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshot_address_contractId_kind_key" ON "PnlSnapshot"("address", "contractId", "kind");

-- AddForeignKey
ALTER TABLE "TradeHistory" ADD CONSTRAINT "TradeHistory_address_fkey" FOREIGN KEY ("address") REFERENCES "User"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeHistory" ADD CONSTRAINT "TradeHistory_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
