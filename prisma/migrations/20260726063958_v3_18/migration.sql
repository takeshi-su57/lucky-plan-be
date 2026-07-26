-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "awaitingEventPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evaluatedPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finalizedPlans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "materializedPlans" INTEGER NOT NULL DEFAULT 0;
