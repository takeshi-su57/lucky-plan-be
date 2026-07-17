-- CreateEnum
CREATE TYPE "SimulationResearchExecutionFlow" AS ENUM ('Centralized', 'DynamicExperimental');

-- CreateEnum
CREATE TYPE "SimulationEvaluatorWorkerDesiredState" AS ENUM ('Running', 'Draining', 'Paused');

-- AlterEnum
ALTER TYPE "SimulationEvaluatorTaskKind" ADD VALUE 'SetWorkerCapacity';

-- AlterEnum
ALTER TYPE "SimulationEvaluatorWorkerRuntimeStatus" ADD VALUE 'Paused';

-- AlterTable
ALTER TABLE "SimulationEvaluatorWorker" ADD COLUMN     "activeCapacity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "desiredCapacity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "desiredState" "SimulationEvaluatorWorkerDesiredState" NOT NULL DEFAULT 'Running';

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "executionFlow" "SimulationResearchExecutionFlow" NOT NULL DEFAULT 'Centralized';
