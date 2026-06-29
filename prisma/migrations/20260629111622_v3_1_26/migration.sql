/*
  Warnings:

  - You are about to drop the column `maxR2` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `maxSlope` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `maxTrades` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `minNegativeR2` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `minR2` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `minSlope` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `minTrades` on the `Simulation` table. All the data in the column will be lost.
  - You are about to drop the column `maxLeverageGap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxLeverageMax` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxLeverageMin` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxR2Gap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxR2Max` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxR2Min` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxSlopeGap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxSlopeMax` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxSlopeMin` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxTradesGap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxTradesMax` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `maxTradesMin` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minR2Gap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minR2Max` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minR2Min` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minSlopeGap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minSlopeMax` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minSlopeMin` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minTradesGap` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minTradesMax` on the `SimulationResearch` table. All the data in the column will be lost.
  - You are about to drop the column `minTradesMin` on the `SimulationResearch` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Simulation" DROP COLUMN "maxR2",
DROP COLUMN "maxSlope",
DROP COLUMN "maxTrades",
DROP COLUMN "minNegativeR2",
DROP COLUMN "minR2",
DROP COLUMN "minSlope",
DROP COLUMN "minTrades",
ADD COLUMN     "r2" JSONB NOT NULL DEFAULT '{"min":0.5,"max":1}',
ADD COLUMN     "slope" JSONB NOT NULL DEFAULT '{"min":0,"max":1000000000}',
ADD COLUMN     "trade" JSONB NOT NULL DEFAULT '{"min":3,"max":1000000}';

-- AlterTable
ALTER TABLE "SimulationResearch" DROP COLUMN "maxLeverageGap",
DROP COLUMN "maxLeverageMax",
DROP COLUMN "maxLeverageMin",
DROP COLUMN "maxR2Gap",
DROP COLUMN "maxR2Max",
DROP COLUMN "maxR2Min",
DROP COLUMN "maxSlopeGap",
DROP COLUMN "maxSlopeMax",
DROP COLUMN "maxSlopeMin",
DROP COLUMN "maxTradesGap",
DROP COLUMN "maxTradesMax",
DROP COLUMN "maxTradesMin",
DROP COLUMN "minR2Gap",
DROP COLUMN "minR2Max",
DROP COLUMN "minR2Min",
DROP COLUMN "minSlopeGap",
DROP COLUMN "minSlopeMax",
DROP COLUMN "minSlopeMin",
DROP COLUMN "minTradesGap",
DROP COLUMN "minTradesMax",
DROP COLUMN "minTradesMin",
ADD COLUMN     "maxLeverage" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "r2" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "slope" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "trade" JSONB NOT NULL DEFAULT '[]';
