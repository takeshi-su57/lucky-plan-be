-- AlterTable
ALTER TABLE "Plan"
ADD COLUMN     "simulationCursor" TIMESTAMP(3),
ADD COLUMN     "simulationSpeed" INTEGER NOT NULL DEFAULT 1;
