-- CreateEnum
CREATE TYPE "SimulationEvaluatorTaskKind" AS ENUM ('EvaluateLeaders', 'PrebuildPlatformCache');

-- CreateEnum
CREATE TYPE "SimulationEvaluatorTaskStatus" AS ENUM ('Queued', 'Ready', 'Claimed', 'Completed', 'Failed', 'Cancelled');

-- CreateEnum
CREATE TYPE "SimulationEvaluatorWorkerAuthorizationStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Disabled');

-- CreateEnum
CREATE TYPE "SimulationEvaluatorWorkerRuntimeStatus" AS ENUM ('Offline', 'Online', 'Free', 'Busy', 'Prebuilding');

-- CreateEnum
CREATE TYPE "SimulationEvaluatorWorkerPlatformCacheStatus" AS ENUM ('Missing', 'Building', 'Ready', 'Failed');

-- CreateTable
CREATE TABLE "SimulationEvaluatorWorker" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT,
    "authorizationStatus" "SimulationEvaluatorWorkerAuthorizationStatus" NOT NULL DEFAULT 'Pending',
    "runtimeStatus" "SimulationEvaluatorWorkerRuntimeStatus" NOT NULL DEFAULT 'Offline',
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastTaskAt" TIMESTAMP(3),
    "lastError" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationEvaluatorWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationEvaluatorWorkerPlatformCache" (
    "id" SERIAL NOT NULL,
    "workerId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "SimulationEvaluatorWorkerPlatformCacheStatus" NOT NULL DEFAULT 'Missing',
    "coveredStartAt" TIMESTAMP(3),
    "coveredEndAt" TIMESTAMP(3),
    "buildingStartAt" TIMESTAMP(3),
    "buildingEndAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastBuiltAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationEvaluatorWorkerPlatformCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationEvaluatorDispatcher" (
    "id" TEXT NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationEvaluatorDispatcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationEvaluatorTask" (
    "id" TEXT NOT NULL,
    "kind" "SimulationEvaluatorTaskKind" NOT NULL,
    "status" "SimulationEvaluatorTaskStatus" NOT NULL DEFAULT 'Queued',
    "simulationId" INTEGER,
    "simulationPlanId" INTEGER,
    "platform" "Platform",
    "targetWorkerId" TEXT,
    "requiredCacheStartAt" TIMESTAMP(3),
    "requiredCacheEndAt" TIMESTAMP(3),
    "rangeStartedAt" TIMESTAMP(3) NOT NULL,
    "rangeEndedAt" TIMESTAMP(3) NOT NULL,
    "input" JSONB NOT NULL,
    "inputChecksum" TEXT NOT NULL,
    "result" JSONB,
    "resultChecksum" TEXT,
    "workerId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "progressBytes" BIGINT NOT NULL DEFAULT 0,
    "progressRecords" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationEvaluatorTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SimulationEvaluatorWorker_publicKey_key" ON "SimulationEvaluatorWorker"("publicKey");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorWorker_authorizationStatus_runtimeStatus_idx" ON "SimulationEvaluatorWorker"("authorizationStatus", "runtimeStatus", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorWorkerPlatformCache_platform_status_cove_idx" ON "SimulationEvaluatorWorkerPlatformCache"("platform", "status", "coveredStartAt", "coveredEndAt");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationEvaluatorWorkerPlatformCache_workerId_platform_key" ON "SimulationEvaluatorWorkerPlatformCache"("workerId", "platform");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorTask_status_createdAt_idx" ON "SimulationEvaluatorTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorTask_workerId_status_idx" ON "SimulationEvaluatorTask"("workerId", "status");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorTask_targetWorkerId_status_idx" ON "SimulationEvaluatorTask"("targetWorkerId", "status");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorTask_platform_status_idx" ON "SimulationEvaluatorTask"("platform", "status");

-- CreateIndex
CREATE INDEX "SimulationEvaluatorTask_simulationId_rangeStartedAt_rangeEn_idx" ON "SimulationEvaluatorTask"("simulationId", "rangeStartedAt", "rangeEndedAt");

-- AddForeignKey
ALTER TABLE "SimulationEvaluatorWorkerPlatformCache" ADD CONSTRAINT "SimulationEvaluatorWorkerPlatformCache_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "SimulationEvaluatorWorker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationEvaluatorTask" ADD CONSTRAINT "SimulationEvaluatorTask_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationEvaluatorTask" ADD CONSTRAINT "SimulationEvaluatorTask_simulationPlanId_fkey" FOREIGN KEY ("simulationPlanId") REFERENCES "SimulationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
