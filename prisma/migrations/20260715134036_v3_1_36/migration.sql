-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "size" JSONB NOT NULL DEFAULT '{"min":0,"max":1000000000}';

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "size" JSONB NOT NULL DEFAULT '[]';
