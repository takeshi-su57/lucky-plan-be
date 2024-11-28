/*
  Warnings:

  - Made the column `followerContractId` on table `Bot` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Bot" ALTER COLUMN "followerContractId" SET NOT NULL;
