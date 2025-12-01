-- CreateEnum
CREATE TYPE "SLTPRequestStatus" AS ENUM ('Live', 'Dead');

-- CreateTable
CREATE TABLE "SLTPRequest" (
    "id" SERIAL NOT NULL,
    "address" TEXT NOT NULL,
    "contractId" INTEGER NOT NULL,
    "positionKey" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "status" "SLTPRequestStatus" NOT NULL DEFAULT 'Dead',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SLTPRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GnsPricingRecord" (
    "id" SERIAL NOT NULL,
    "pair" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GnsPricingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SLTPRequest_address_contractId_positionKey_key" ON "SLTPRequest"("address", "contractId", "positionKey");

-- CreateIndex
CREATE INDEX "GnsPricingRecord_pair_date_idx" ON "GnsPricingRecord"("pair", "date" ASC);

-- AddForeignKey
ALTER TABLE "SLTPRequest" ADD CONSTRAINT "SLTPRequest_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
