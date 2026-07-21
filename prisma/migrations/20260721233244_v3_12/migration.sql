/*
  Warnings:

  - You are about to drop the column `executionFlow` on the `SimulationResearch` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SimulationResearch" DROP COLUMN "executionFlow";

-- DropEnum
DROP TYPE "SimulationResearchExecutionFlow";
