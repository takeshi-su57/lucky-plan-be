/*
  Warnings:

  - The primary key for the `WalletAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `_TagToWalletAccount` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[userId,address]` on the table `WalletAccount` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `WalletAccount` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `B` on the `_TagToWalletAccount` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_B_fkey";

-- AlterTable
ALTER TABLE "WalletAccount" DROP CONSTRAINT "WalletAccount_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "address" SET DATA TYPE TEXT,
ADD CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_AB_pkey",
DROP COLUMN "B",
ADD COLUMN     "B" INTEGER NOT NULL,
ADD CONSTRAINT "_TagToWalletAccount_AB_pkey" PRIMARY KEY ("A", "B");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_userId_address_key" ON "WalletAccount"("userId", "address");

-- CreateIndex
CREATE INDEX "_TagToWalletAccount_B_index" ON "_TagToWalletAccount"("B");

-- AddForeignKey
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_B_fkey" FOREIGN KEY ("B") REFERENCES "WalletAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
