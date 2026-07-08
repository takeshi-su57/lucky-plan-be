-- AlterEnum
ALTER TYPE "SimulationStatus" ADD VALUE 'Queued';

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "completedRanges" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cursor" TIMESTAMP(3),
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "progressMessage" TEXT,
ADD COLUMN     "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "progressPhase" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SimulationStatus" NOT NULL DEFAULT 'Created',
ADD COLUMN     "totalRanges" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "SimulationResearch_status_createdAt_idx" ON "SimulationResearch"("status", "createdAt");
