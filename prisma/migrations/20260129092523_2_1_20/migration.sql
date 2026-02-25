/*
  Warnings:

  - You are about to drop the column `optunaStudyPath` on the `BacktestTask` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ValidationPipelineStatus" AS ENUM ('CREATED', 'LAYER_1_RUNNING', 'LAYER_1_DONE', 'LAYER_2_RUNNING', 'LAYER_2_DONE', 'LAYER_3_RUNNING', 'LAYER_3_DONE', 'AWAITING_USER_SELECTION', 'LAYER_5_RUNNING', 'LAYER_5_DONE', 'AWAITING_FINAL_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ValidationCandidateStatus" AS ENUM ('PENDING', 'PASSED_THRESHOLD', 'FAILED_THRESHOLD', 'PARETO_OPTIMAL', 'PARETO_DOMINATED', 'WFA_PENDING', 'WFA_PASSED', 'WFA_FAILED', 'USER_SELECTED', 'USER_REJECTED', 'ROBUSTNESS_PENDING', 'ROBUSTNESS_PASSED', 'ROBUSTNESS_FAILED', 'FINAL_APPROVED', 'FINAL_REJECTED');

-- CreateEnum
CREATE TYPE "WalkForwardStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "RobustnessTestStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "BacktestTask" DROP COLUMN "optunaStudyPath";

-- CreateTable
CREATE TABLE "ValidationPipeline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateSearchId" TEXT NOT NULL,
    "status" "ValidationPipelineStatus" NOT NULL DEFAULT 'CREATED',
    "thresholdConfig" JSONB NOT NULL,
    "paretoMetrics" TEXT[],
    "wfaTrainRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "wfaWindows" INTEGER NOT NULL DEFAULT 3,
    "wfaMinConsistency" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "robustnessSteps" INTEGER NOT NULL DEFAULT 10,
    "robustnessMinScore" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "totalCandidates" INTEGER NOT NULL DEFAULT 0,
    "passedThreshold" INTEGER NOT NULL DEFAULT 0,
    "paretoOptimal" INTEGER NOT NULL DEFAULT 0,
    "passedWfa" INTEGER NOT NULL DEFAULT 0,
    "userSelected" INTEGER NOT NULL DEFAULT 0,
    "passedRobustness" INTEGER NOT NULL DEFAULT 0,
    "finalApproved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "ValidationPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationCandidate" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "status" "ValidationCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "thresholdPassed" BOOLEAN,
    "thresholdDetails" JSONB,
    "paretoRank" INTEGER,
    "dominatedBy" TEXT[],
    "wfaConsistency" DOUBLE PRECISION,
    "wfaPassed" BOOLEAN,
    "userSelectedAt" TIMESTAMP(3),
    "userNotes" TEXT,
    "robustnessScore" DOUBLE PRECISION,
    "robustnessPassed" BOOLEAN,
    "finalApprovedAt" TIMESTAMP(3),
    "finalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardResult" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "windowIndex" INTEGER NOT NULL,
    "status" "WalkForwardStatus" NOT NULL DEFAULT 'PENDING',
    "trainStart" TIMESTAMP(3) NOT NULL,
    "trainEnd" TIMESTAMP(3) NOT NULL,
    "trainMetrics" JSONB,
    "testStart" TIMESTAMP(3) NOT NULL,
    "testEnd" TIMESTAMP(3) NOT NULL,
    "testMetrics" JSONB,
    "consistency" DOUBLE PRECISION,
    "degradation" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkForwardResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobustnessTest" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "status" "RobustnessTestStatus" NOT NULL DEFAULT 'PENDING',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB,
    "sharpeRatio" DOUBLE PRECISION,
    "totalPnl" DOUBLE PRECISION,
    "maxDrawdown" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobustnessTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValidationPipeline_status_idx" ON "ValidationPipeline"("status");

-- CreateIndex
CREATE INDEX "ValidationPipeline_templateSearchId_idx" ON "ValidationPipeline"("templateSearchId");

-- CreateIndex
CREATE INDEX "ValidationCandidate_pipelineId_status_idx" ON "ValidationCandidate"("pipelineId", "status");

-- CreateIndex
CREATE INDEX "ValidationCandidate_resultId_idx" ON "ValidationCandidate"("resultId");

-- CreateIndex
CREATE UNIQUE INDEX "ValidationCandidate_pipelineId_resultId_key" ON "ValidationCandidate"("pipelineId", "resultId");

-- CreateIndex
CREATE INDEX "WalkForwardResult_candidateId_idx" ON "WalkForwardResult"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "WalkForwardResult_candidateId_windowIndex_key" ON "WalkForwardResult"("candidateId", "windowIndex");

-- CreateIndex
CREATE INDEX "RobustnessTest_candidateId_idx" ON "RobustnessTest"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "RobustnessTest_candidateId_stepIndex_key" ON "RobustnessTest"("candidateId", "stepIndex");

-- AddForeignKey
ALTER TABLE "ValidationPipeline" ADD CONSTRAINT "ValidationPipeline_templateSearchId_fkey" FOREIGN KEY ("templateSearchId") REFERENCES "TemplateSearch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationCandidate" ADD CONSTRAINT "ValidationCandidate_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ValidationPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationCandidate" ADD CONSTRAINT "ValidationCandidate_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "BacktestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardResult" ADD CONSTRAINT "WalkForwardResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ValidationCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobustnessTest" ADD CONSTRAINT "RobustnessTest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ValidationCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
