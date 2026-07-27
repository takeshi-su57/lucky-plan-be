-- AlterTable
ALTER TABLE "SimulationBotCache" ADD COLUMN "snapshotCapturedAt" TIMESTAMP(3);

-- A completed root cache, or any cache with persisted event logs, was already
-- materialized before this marker existed. Derived caches without event logs
-- are intentionally left unmarked: they cannot safely serve as a source.
UPDATE "SimulationBotCache" AS cache
SET "snapshotCapturedAt" = cache."updatedAt"
FROM "SimulationBot" AS bot
JOIN "SimulationPlan" AS plan ON plan.id = bot."simulationPlanId"
JOIN "Simulation" AS simulation ON simulation.id = plan."simulationId"
WHERE cache."simulationBotId" = bot.id
  AND cache."eventSnapshotVersion" >= 2
  AND (
    simulation."sourceSimulationId" IS NULL AND cache.completed = TRUE
    OR EXISTS (
      SELECT 1
      FROM "SimulationBotCachedEventLog" AS event_log
      WHERE event_log."simulationBotCacheId" = cache.id
    )
  );
