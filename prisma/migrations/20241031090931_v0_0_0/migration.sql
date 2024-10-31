-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Leader', 'User');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('Live', 'Finish', 'Dead');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('Created', 'Await', 'Failed', 'Completed');

-- CreateTable
CREATE TABLE "Metadata" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "address" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "Follower" (
    "address" VARCHAR(255) NOT NULL,
    "publicKey" TEXT NOT NULL,
    "accountIndex" INTEGER NOT NULL,

    CONSTRAINT "Follower_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "StrategyMetadata" (
    "key" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "StrategyMetadata_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" SERIAL NOT NULL,
    "strategyKey" TEXT NOT NULL,
    "params" TEXT NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" SERIAL NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bot" (
    "id" SERIAL NOT NULL,
    "leaderAddress" VARCHAR(255) NOT NULL,
    "followerAddress" VARCHAR(255) NOT NULL,
    "strategyId" INTEGER NOT NULL,
    "contractId" INTEGER NOT NULL,
    "startedBlock" INTEGER NOT NULL,
    "pausedBlock" INTEGER NOT NULL,
    "endedBlock" INTEGER NOT NULL,
    "status" "BotStatus" NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "index" INTEGER NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" SERIAL NOT NULL,
    "botId" INTEGER NOT NULL,
    "targetPositionId" INTEGER NOT NULL,
    "achievePositionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "missionId" INTEGER NOT NULL,
    "actionId" INTEGER NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Metadata_key_key" ON "Metadata"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Follower_publicKey_key" ON "Follower"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Follower_accountIndex_key" ON "Follower"("accountIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_strategyKey_params_key" ON "Strategy"("strategyKey", "params");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_chainId_address_key" ON "Contract"("chainId", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Position_address_index_key" ON "Position"("address", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_botId_targetPositionId_key" ON "Mission"("botId", "targetPositionId");

-- AddForeignKey
ALTER TABLE "Follower" ADD CONSTRAINT "Follower_address_fkey" FOREIGN KEY ("address") REFERENCES "User"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_strategyKey_fkey" FOREIGN KEY ("strategyKey") REFERENCES "StrategyMetadata"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_followerAddress_fkey" FOREIGN KEY ("followerAddress") REFERENCES "Follower"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_leaderAddress_fkey" FOREIGN KEY ("leaderAddress") REFERENCES "User"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_targetPositionId_fkey" FOREIGN KEY ("targetPositionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_achievePositionId_fkey" FOREIGN KEY ("achievePositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
