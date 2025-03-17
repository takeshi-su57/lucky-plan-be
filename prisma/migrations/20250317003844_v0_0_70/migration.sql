/*
  Warnings:

  - A unique constraint covering the columns `[userId,accountIndex]` on the table `Follower` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Follower_accountIndex_key";

-- AlterTable
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_TagToWalletAccount_AB_unique";

-- CreateIndex
CREATE UNIQUE INDEX "Follower_userId_accountIndex_key" ON "Follower"("userId", "accountIndex");
