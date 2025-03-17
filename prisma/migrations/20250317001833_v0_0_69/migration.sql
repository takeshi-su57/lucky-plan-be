/*
  Warnings:

  - The primary key for the `Tag` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[userId,tag]` on the table `Tag` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,category]` on the table `TagCategory` will be added. If there are existing duplicate values, this will fail.
  - Made the column `planId` on table `Bot` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `userId` to the `Tag` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `TagCategory` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `A` on the `_TagToWalletAccount` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "Bot" DROP CONSTRAINT "Bot_planId_fkey";

-- DropForeignKey
ALTER TABLE "_TagToWalletAccount" DROP CONSTRAINT "_TagToWalletAccount_A_fkey";

-- DropIndex
DROP INDEX "TagCategory_category_key";

-- AlterTable
ALTER TABLE "Bot" ALTER COLUMN "planId" SET NOT NULL,
ALTER COLUMN "planId" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Follower" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '0x104b4e127b9a6c82044c972caff88e75f41ae8cc';

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "userId" TEXT NOT NULL DEFAULT '0x104b4e127b9a6c82044c972caff88e75f41ae8cc';

-- AlterTable
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_pkey",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL,
ALTER COLUMN "tag" SET DATA TYPE TEXT,
ADD CONSTRAINT "Tag_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "TagCategory" ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "_TagToWalletAccount" DROP COLUMN "A",
ADD COLUMN     "A" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Tag_userId_tag_key" ON "Tag"("userId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "TagCategory_userId_category_key" ON "TagCategory"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "_TagToWalletAccount_AB_unique" ON "_TagToWalletAccount"("A", "B");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_A_fkey" FOREIGN KEY ("A") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
