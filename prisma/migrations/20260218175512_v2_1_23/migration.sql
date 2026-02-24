-- CreateTable
CREATE TABLE "ParetoStep" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "metrics" TEXT[],
    "optimalCandidateIds" TEXT[],
    "candidatesBefore" INTEGER NOT NULL,
    "candidatesAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParetoStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParetoStep_pipelineId_idx" ON "ParetoStep"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "ParetoStep_pipelineId_stepOrder_key" ON "ParetoStep"("pipelineId", "stepOrder");

-- AddForeignKey
ALTER TABLE "ParetoStep" ADD CONSTRAINT "ParetoStep_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ValidationPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
