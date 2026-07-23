-- AlterEnum
ALTER TYPE "SimulationEvaluatorTaskKind" ADD VALUE 'UpgradeWorker';

-- AlterTable
ALTER TABLE "SimulationEvaluatorWorker" ADD COLUMN     "version" TEXT,
ADD COLUMN     "versionReportedAt" TIMESTAMP(3);
