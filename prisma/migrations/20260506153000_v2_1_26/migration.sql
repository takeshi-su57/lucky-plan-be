-- Move strategy runtime params out of JSON blob into explicit columns
ALTER TABLE "Strategy"
ADD COLUMN "tpPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "slPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "maxOpenMissions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "selectedPairs" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'default';

UPDATE "Strategy"
SET
  "tpPercentage" = COALESCE(("params"::jsonb ->> 'tpPercentage')::double precision, 0),
  "slPercentage" = COALESCE(("params"::jsonb ->> 'slPercentage')::double precision, 0),
  "maxOpenMissions" = COALESCE(("params"::jsonb ->> 'maxOpenMissions')::integer, 0),
  "selectedPairs" = COALESCE(("params"::jsonb -> 'selectedPairs')::text, '[]'),
  "mode" = COALESCE(NULLIF(("params"::jsonb ->> 'mode'), ''), 'default');

ALTER TABLE "Strategy" DROP COLUMN "params";
ALTER TABLE "Strategy" DROP COLUMN "collateralBaseline";
