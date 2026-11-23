-- CreateEnum
CREATE TYPE "RpcEndpointProvider" AS ENUM ('DRPC', 'ALCHEMY', 'PUBLIC', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RpcEndpointTier" AS ENUM ('Free', 'Paid');

-- CreateEnum
CREATE TYPE "RpcEndpointState" AS ENUM ('Active', 'Paused', 'Disabled');

-- CreateTable
CREATE TABLE "RpcEndpoint" (
    "id" SERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "provider" "RpcEndpointProvider" NOT NULL,
    "tier" "RpcEndpointTier" NOT NULL DEFAULT 'Free',
    "label" TEXT,
    "url" TEXT NOT NULL,
    "maxBlockRange" INTEGER,
    "state" "RpcEndpointState" NOT NULL DEFAULT 'Active',
    "stateReason" TEXT,
    "stateChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RpcEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RpcEndpoint_chainId_state_idx" ON "RpcEndpoint"("chainId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RpcEndpoint_chainId_url_key" ON "RpcEndpoint"("chainId", "url");

