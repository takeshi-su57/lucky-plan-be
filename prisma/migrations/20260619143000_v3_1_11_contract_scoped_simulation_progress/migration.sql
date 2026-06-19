-- Track simulation progress per leader contract while keeping global percent monotonic.
ALTER TABLE "SimulationProgressLog"
ADD COLUMN "contractId" INTEGER,
ADD COLUMN "contractAddress" TEXT,
ADD COLUMN "contractPlatform" TEXT,
ADD COLUMN "contractIndex" INTEGER,
ADD COLUMN "contractCount" INTEGER,
ADD COLUMN "contractPercent" DOUBLE PRECISION;

CREATE INDEX "SimulationProgressLog_planId_contractId_createdAt_id_idx" ON "SimulationProgressLog"("planId", "contractId", "createdAt" DESC, "id" DESC);
