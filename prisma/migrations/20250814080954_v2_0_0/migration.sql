-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('GNS');

-- CreateEnum
CREATE TYPE "Version" AS ENUM ('V9', 'V10');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "fromBlock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platform" "Platform" NOT NULL DEFAULT 'GNS',
ADD COLUMN     "toBlock" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" "Version" NOT NULL DEFAULT 'V9';

-- CreateTable
CREATE TABLE "EventLog" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "jsonLog" TEXT NOT NULL,
    "block" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerpTradingEventLog" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "jsonLog" TEXT NOT NULL,
    "usdPnl" DOUBLE PRECISION NOT NULL,
    "block" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerpTradingEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnlSnapshotV2" (
    "id" SERIAL NOT NULL,
    "platform" "Platform" NOT NULL,
    "version" "Version" NOT NULL,
    "contractId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "dateStr" TEXT NOT NULL,
    "kind" "PnlSnapshotKind" NOT NULL,
    "accUSDPnl" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "PnlSnapshotV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PnlSnapshotV2InitializedFlag" (
    "id" SERIAL NOT NULL,
    "dateStr" TEXT NOT NULL,
    "isInit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PnlSnapshotV2InitializedFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventLog_contractId_block_logIndex_key" ON "EventLog"("contractId", "block", "logIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PerpTradingEventLog_contractId_block_logIndex_key" ON "PerpTradingEventLog"("contractId", "block", "logIndex");

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_accUSDPnl_idx" ON "PnlSnapshotV2"("accUSDPnl" DESC);

-- CreateIndex
CREATE INDEX "PnlSnapshotV2_platform_idx" ON "PnlSnapshotV2"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshotV2_address_contractId_dateStr_kind_key" ON "PnlSnapshotV2"("address", "contractId", "dateStr", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshotV2InitializedFlag_dateStr_key" ON "PnlSnapshotV2InitializedFlag"("dateStr");
