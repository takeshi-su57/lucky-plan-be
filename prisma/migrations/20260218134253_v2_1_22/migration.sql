/*
  Warnings:

  - The values [PASSED_THRESHOLD,FAILED_THRESHOLD,WFA_PENDING,ROBUSTNESS_PENDING] on the enum `ValidationCandidateStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [LAYER_1_RUNNING,LAYER_1_DONE,LAYER_2_RUNNING,LAYER_2_DONE,LAYER_3_RUNNING,LAYER_3_DONE,AWAITING_USER_SELECTION,LAYER_5_RUNNING,LAYER_5_DONE,AWAITING_FINAL_APPROVAL] on the enum `ValidationPipelineStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `thresholdDetails` on the `ValidationCandidate` table. All the data in the column will be lost.
  - You are about to drop the column `paretoMetrics` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `robustnessMinScore` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `robustnessSteps` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `templateSearchId` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `thresholdConfig` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `wfaMinConsistency` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `wfaTrainRatio` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the column `wfaWindows` on the `ValidationPipeline` table. All the data in the column will be lost.
  - You are about to drop the `RobustnessTest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WalkForwardResult` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `backtestTaskId` to the `ValidationPipeline` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ValidationCandidateStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'THRESHOLD_ELIMINATED', 'PARETO_OPTIMAL', 'PARETO_DOMINATED', 'WFA_PASSED', 'WFA_FAILED', 'USER_SELECTED', 'USER_REJECTED', 'ROBUSTNESS_PASSED', 'ROBUSTNESS_FAILED', 'FINAL_APPROVED', 'FINAL_REJECTED');
ALTER TABLE "public"."ValidationCandidate" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ValidationCandidate" ALTER COLUMN "status" TYPE "ValidationCandidateStatus_new" USING ("status"::text::"ValidationCandidateStatus_new");
ALTER TYPE "ValidationCandidateStatus" RENAME TO "ValidationCandidateStatus_old";
ALTER TYPE "ValidationCandidateStatus_new" RENAME TO "ValidationCandidateStatus";
DROP TYPE "public"."ValidationCandidateStatus_old";
ALTER TABLE "ValidationCandidate" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ValidationPipelineStatus_new" AS ENUM ('CREATED', 'STEP_THRESHOLD', 'STEP_PARETO', 'STEP_WFA', 'STEP_USER_SELECTION', 'STEP_ROBUSTNESS', 'STEP_FINAL_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');
ALTER TABLE "public"."ValidationPipeline" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ValidationPipeline" ALTER COLUMN "status" TYPE "ValidationPipelineStatus_new" USING ("status"::text::"ValidationPipelineStatus_new");
ALTER TYPE "ValidationPipelineStatus" RENAME TO "ValidationPipelineStatus_old";
ALTER TYPE "ValidationPipelineStatus_new" RENAME TO "ValidationPipelineStatus";
DROP TYPE "public"."ValidationPipelineStatus_old";
ALTER TABLE "ValidationPipeline" ALTER COLUMN "status" SET DEFAULT 'CREATED';
COMMIT;

-- DropForeignKey
ALTER TABLE "RobustnessTest" DROP CONSTRAINT "RobustnessTest_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "ValidationPipeline" DROP CONSTRAINT "ValidationPipeline_templateSearchId_fkey";

-- DropForeignKey
ALTER TABLE "WalkForwardResult" DROP CONSTRAINT "WalkForwardResult_candidateId_fkey";

-- DropIndex
DROP INDEX "ValidationPipeline_templateSearchId_idx";

-- AlterTable
ALTER TABLE "ValidationCandidate" DROP COLUMN "thresholdDetails",
ADD COLUMN     "robustnessStepResults" JSONB,
ADD COLUMN     "wfaWindowResults" JSONB;

-- AlterTable
ALTER TABLE "ValidationPipeline" DROP COLUMN "paretoMetrics",
DROP COLUMN "robustnessMinScore",
DROP COLUMN "robustnessSteps",
DROP COLUMN "templateSearchId",
DROP COLUMN "thresholdConfig",
DROP COLUMN "wfaMinConsistency",
DROP COLUMN "wfaTrainRatio",
DROP COLUMN "wfaWindows",
ADD COLUMN     "backtestTaskId" TEXT NOT NULL,
ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paretoConfig" JSONB,
ADD COLUMN     "robustnessCompletedSteps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "robustnessConfig" JSONB,
ADD COLUMN     "wfaCompletedWindows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wfaConfig" JSONB;

-- DropTable
DROP TABLE "RobustnessTest";

-- DropTable
DROP TABLE "WalkForwardResult";

-- DropEnum
DROP TYPE "RobustnessTestStatus";

-- DropEnum
DROP TYPE "WalkForwardStatus";

-- CreateTable
CREATE TABLE "ThresholdStep" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "metricName" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "candidatesBefore" INTEGER NOT NULL,
    "candidatesAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThresholdStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThresholdStep_pipelineId_idx" ON "ThresholdStep"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "ThresholdStep_pipelineId_stepOrder_key" ON "ThresholdStep"("pipelineId", "stepOrder");

-- CreateIndex
CREATE INDEX "ValidationPipeline_backtestTaskId_idx" ON "ValidationPipeline"("backtestTaskId");

-- AddForeignKey
ALTER TABLE "ValidationPipeline" ADD CONSTRAINT "ValidationPipeline_backtestTaskId_fkey" FOREIGN KEY ("backtestTaskId") REFERENCES "BacktestTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThresholdStep" ADD CONSTRAINT "ThresholdStep_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ValidationPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
