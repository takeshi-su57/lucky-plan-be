/*
  Warnings:

  - You are about to drop the column `totalPnl` on the `SimulationPlan` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SimulationPlan" DROP COLUMN "totalPnl",
ADD COLUMN     "totalFollowerPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalLeaderPnl" DOUBLE PRECISION NOT NULL DEFAULT 0;
