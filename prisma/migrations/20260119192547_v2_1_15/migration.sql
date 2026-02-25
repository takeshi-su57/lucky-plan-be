-- AlterTable
ALTER TABLE "BacktestTask" ADD COLUMN     "bestParams" JSONB,
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'maximize',
ADD COLUMN     "optimizationMetric" TEXT,
ADD COLUMN     "optimizerPid" INTEGER,
ADD COLUMN     "optunaStudyPath" TEXT,
ADD COLUMN     "searchStrategy" TEXT NOT NULL DEFAULT 'grid',
ADD COLUMN     "trials" INTEGER;

-- CreateIndex
CREATE INDEX "BacktestTask_searchStrategy_idx" ON "BacktestTask"("searchStrategy");
