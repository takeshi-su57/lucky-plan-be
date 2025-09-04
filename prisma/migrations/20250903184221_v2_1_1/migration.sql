/*
  Warnings:

  - Added the required column `targetPositionBlockNumber` to the `Mission` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetPositionLogIndex` to the `Mission` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "achievePositionBlockNumber" INTEGER,
ADD COLUMN     "achievePositionLogIndex" INTEGER,
ADD COLUMN     "targetPositionBlockNumber" INTEGER NOT NULL,
ADD COLUMN     "targetPositionLogIndex" INTEGER NOT NULL;
