-- AlterTable
ALTER TABLE "SimulationEvaluatorWorker" ADD COLUMN     "lastDiagnostic" JSONB,
ADD COLUMN     "lastDiagnosticAt" TIMESTAMP(3);
