/*
  Warnings:

  - You are about to drop the column `contractId` on the `Bot` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[leaderAddress,followerAddress,strategyId,leaderContractId,startedBlock]` on the table `Bot` will be added. If there are existing duplicate values, this will fail.
  - Made the column `leaderContractId` on table `Bot` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Bot" DROP CONSTRAINT "Bot_contractId_fkey";

-- DropIndex
DROP INDEX "Bot_leaderAddress_followerAddress_strategyId_contractId_sta_key";

-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "contractId",
ALTER COLUMN "leaderContractId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Bot_leaderAddress_followerAddress_strategyId_leaderContract_key" ON "Bot"("leaderAddress", "followerAddress", "strategyId", "leaderContractId", "startedBlock");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_leaderContractId_fkey" FOREIGN KEY ("leaderContractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
