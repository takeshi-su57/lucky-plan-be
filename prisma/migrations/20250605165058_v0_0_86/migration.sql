/*
  Warnings:

  - The primary key for the `_TagToWalletAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[A,B]` on the table `_TagToWalletAccount` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Mission_botId_targetPositionId_key";

-- AlterTable
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_AB_pkey";

-- CreateIndex
CREATE UNIQUE INDEX "_TagToWalletAccount_AB_unique" ON "_TagToWalletAccount"("A", "B");
