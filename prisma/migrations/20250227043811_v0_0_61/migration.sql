/*
  Warnings:

  - You are about to drop the column `userAddress` on the `Bot` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Bot" DROP CONSTRAINT "Bot_userAddress_fkey";

-- DropForeignKey
ALTER TABLE "Follower" DROP CONSTRAINT "Follower_address_fkey";

-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "userAddress";
