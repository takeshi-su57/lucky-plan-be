-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "behavioralFilters" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "behavioralFeatures" JSONB;

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "behavioralFilters" JSONB NOT NULL DEFAULT '{}';
