/*
  Warnings:

  - You are about to drop the `SimulationLeaderSelection` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SimulationLeaderSelection" DROP CONSTRAINT "SimulationLeaderSelection_simulationId_fkey";

-- DropForeignKey
ALTER TABLE "SimulationLeaderSelection" DROP CONSTRAINT "SimulationLeaderSelection_simulationPlanId_fkey";

-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "gapDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "score" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "score" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "days" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "gapDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "score" JSONB NOT NULL DEFAULT '[]';

-- DropTable
DROP TABLE "SimulationLeaderSelection";
