-- DropForeignKey
ALTER TABLE "Bot" DROP CONSTRAINT "Bot_leaderAddress_fkey";

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "userAddress" VARCHAR(255);

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_userAddress_fkey" FOREIGN KEY ("userAddress") REFERENCES "User"("address") ON DELETE SET NULL ON UPDATE CASCADE;
