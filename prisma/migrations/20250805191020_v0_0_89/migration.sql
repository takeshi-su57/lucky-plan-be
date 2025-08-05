-- AlterEnum
ALTER TYPE "TradeActionType" ADD VALUE 'TradePosPnlRealized';

-- AlterTable
ALTER TABLE "TradeHistory" ADD COLUMN     "isCounterTrade" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "meta" TEXT;

-- AlterTable
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_TagToWalletAccount_AB_unique";
