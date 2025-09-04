-- CreateTable
CREATE TABLE "GMXPositionIndexRecord" (
    "id" SERIAL NOT NULL,
    "contractId" INTEGER NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "positionKey" VARCHAR(255) NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,

    CONSTRAINT "GMXPositionIndexRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GMXPositionIndexRecord_positionKey_blockNumber_logIndex_idx" ON "GMXPositionIndexRecord"("positionKey", "blockNumber" ASC, "logIndex" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "GMXPositionIndexRecord_contractId_address_index_key" ON "GMXPositionIndexRecord"("contractId", "address", "index");

-- CreateIndex
CREATE UNIQUE INDEX "GMXPositionIndexRecord_contractId_address_positionKey_block_key" ON "GMXPositionIndexRecord"("contractId", "address", "positionKey", "blockNumber", "logIndex");
