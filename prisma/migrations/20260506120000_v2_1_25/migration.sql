-- Drop legacy StrategyMetadata relation and strategy key
ALTER TABLE "Strategy" DROP CONSTRAINT IF EXISTS "Strategy_strategyKey_fkey";
ALTER TABLE "Strategy" DROP COLUMN IF EXISTS "strategyKey";
DROP TABLE IF EXISTS "StrategyMetadata";
