-- CreateEnum
CREATE TYPE "ActionOrigin" AS ENUM ('Chain', 'Manual', 'System', 'Clone', 'Simulation');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('Observed', 'Confirmed', 'Orphaned');

-- CreateEnum
CREATE TYPE "ActionProcessingStatus" AS ENUM ('Pending', 'Processing', 'Processed', 'Failed');

-- AlterTable
ALTER TABLE "Action"
ADD COLUMN     "contractId" INTEGER,
ADD COLUMN     "origin" "ActionOrigin" NOT NULL DEFAULT 'Chain',
ADD COLUMN     "status" "ActionStatus" NOT NULL DEFAULT 'Observed',
ADD COLUMN     "blockHash" TEXT,
ADD COLUMN     "txHash" TEXT,
ADD COLUMN     "dedupeKey" TEXT;

-- Backfill existing chain-like actions where the contract can be inferred later by application code.
-- Existing rows keep a NULL contractId so the chain uniqueness constraint does not reject old data.

-- CreateTable
CREATE TABLE "ActionProcessing" (
    "actionId" INTEGER NOT NULL,
    "processor" TEXT NOT NULL,
    "status" "ActionProcessingStatus" NOT NULL DEFAULT 'Pending',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionProcessing_pkey" PRIMARY KEY ("actionId","processor")
);

-- CreateIndex
CREATE UNIQUE INDEX "Action_contractId_blockNumber_orderInBlock_key" ON "Action"("contractId", "blockNumber", "orderInBlock");

-- CreateIndex
CREATE UNIQUE INDEX "Action_dedupeKey_key" ON "Action"("dedupeKey");

-- CreateIndex
CREATE INDEX "Action_contractId_address_blockNumber_orderInBlock_idx" ON "Action"("contractId", "address", "blockNumber", "orderInBlock");

-- CreateIndex
CREATE INDEX "ActionProcessing_processor_status_updatedAt_idx" ON "ActionProcessing"("processor", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProcessing" ADD CONSTRAINT "ActionProcessing_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
