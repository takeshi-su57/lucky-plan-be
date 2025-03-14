/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_TagToUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_TagToUser" DROP CONSTRAINT "_TagToUser_A_fkey";

-- DropForeignKey
ALTER TABLE "_TagToUser" DROP CONSTRAINT "_TagToUser_B_fkey";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "_TagToUser";

-- CreateTable
CREATE TABLE "WalletAccount" (
    "address" VARCHAR(255) NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "_TagToWalletAccount" (
    "A" VARCHAR(255) NOT NULL,
    "B" VARCHAR(255) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_TagToWalletAccount_AB_unique" ON "_TagToWalletAccount"("A", "B");

-- CreateIndex
CREATE INDEX "_TagToWalletAccount_B_index" ON "_TagToWalletAccount"("B");

-- AddForeignKey
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag"("tag") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_B_fkey" FOREIGN KEY ("B") REFERENCES "WalletAccount"("address") ON DELETE CASCADE ON UPDATE CASCADE;
