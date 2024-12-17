-- DropIndex
DROP INDEX "Strategy_strategyKey_params_key";

-- AlterTable
ALTER TABLE "Strategy" ALTER COLUMN "minGas" SET DEFAULT '1000000000000000';
