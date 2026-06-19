-- Persist simulation progress so the frontend can replay widget state after refresh.
CREATE TABLE "SimulationProgressLog" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT,
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "leaderActionCount" INTEGER NOT NULL DEFAULT 0,
    "virtualActionCount" INTEGER NOT NULL DEFAULT 0,
    "virtualTaskCount" INTEGER NOT NULL DEFAULT 0,
    "finalizedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "stoppedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "executionIterations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationProgressLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SimulationProgressLog_planId_createdAt_id_idx" ON "SimulationProgressLog"("planId", "createdAt" DESC, "id" DESC);
CREATE INDEX "SimulationProgressLog_runId_createdAt_id_idx" ON "SimulationProgressLog"("runId", "createdAt" ASC, "id" ASC);
CREATE INDEX "SimulationProgressLog_userId_planId_createdAt_idx" ON "SimulationProgressLog"("userId", "planId", "createdAt" DESC);

ALTER TABLE "SimulationProgressLog" ADD CONSTRAINT "SimulationProgressLog_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
