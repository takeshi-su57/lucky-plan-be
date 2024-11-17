/*
  Warnings:

  - Added the required column `blockNumber` to the `Action` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orderInBlock` to the `Action` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'Initiated';

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "blockNumber" INTEGER NOT NULL,
ADD COLUMN     "orderInBlock" INTEGER NOT NULL;
