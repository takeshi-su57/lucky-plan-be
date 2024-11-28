/*
  Warnings:

  - You are about to drop the column `endedBlock` on the `Bot` table. All the data in the column will be lost.
  - You are about to drop the column `startedBlock` on the `Bot` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "endedBlock",
DROP COLUMN "startedBlock",
ADD COLUMN     "followerEndedBlock" INTEGER,
ADD COLUMN     "followerStartedBlock" INTEGER,
ADD COLUMN     "leaderEndedBlock" INTEGER,
ADD COLUMN     "leaderStartedBlock" INTEGER;
