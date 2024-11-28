-- DropIndex
DROP INDEX "Bot_leaderAddress_followerAddress_strategyId_leaderContract_key";

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_followerContractId_fkey" FOREIGN KEY ("followerContractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
