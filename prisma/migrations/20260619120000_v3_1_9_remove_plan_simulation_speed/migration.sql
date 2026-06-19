-- Drop simulation speed from persistent plan state.
-- Speed is a resume-time execution parameter, not a plan attribute.
ALTER TABLE "Plan" DROP COLUMN IF EXISTS "simulationSpeed";
