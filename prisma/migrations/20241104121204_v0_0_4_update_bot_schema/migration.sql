/*
  Warnings:

  - A unique constraint covering the columns `[leaderAddress,followerAddress,strategyId,contractId,startedBlock]` on the table `Bot` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Bot_leaderAddress_followerAddress_strategyId_contractId_sta_key" ON "Bot"("leaderAddress", "followerAddress", "strategyId", "contractId", "startedBlock");
