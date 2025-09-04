/*
  Warnings:

  - You are about to drop the column `positionId` on the `Action` table. All the data in the column will be lost.
  - You are about to drop the column `achievePositionId` on the `Mission` table. All the data in the column will be lost.
  - You are about to drop the column `targetPositionId` on the `Mission` table. All the data in the column will be lost.
  - You are about to drop the `GMXPositionIndexRecord` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Position` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `positionKey` to the `Action` table without a default value. This is not possible if the table is not empty.
  - Added the required column `targetPositionKey` to the `Mission` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Action" DROP CONSTRAINT "Action_positionId_fkey";

-- DropForeignKey
ALTER TABLE "Mission" DROP CONSTRAINT "Mission_achievePositionId_fkey";

-- DropForeignKey
ALTER TABLE "Mission" DROP CONSTRAINT "Mission_targetPositionId_fkey";

-- DropForeignKey
ALTER TABLE "Position" DROP CONSTRAINT "Position_contractId_fkey";

-- AlterTable
ALTER TABLE "Action" DROP COLUMN "positionId",
ADD COLUMN     "positionKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Mission" DROP COLUMN "achievePositionId",
DROP COLUMN "targetPositionId",
ADD COLUMN     "achievePositionKey" TEXT,
ADD COLUMN     "targetPositionKey" TEXT NOT NULL;

-- DropTable
DROP TABLE "GMXPositionIndexRecord";

-- DropTable
DROP TABLE "Position";
