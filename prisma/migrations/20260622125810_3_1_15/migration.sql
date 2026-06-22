/*
  Warnings:

  - Added the required column `avgCollateral` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgDuration` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgLeverage` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgNegativePnl` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgPnl` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgPnlPercentageByCollateral` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgPnlPercentageBySize` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgPositivePnl` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `avgSize` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxDuration` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `openedPositions` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPnl` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPositions` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `openedPositions` to the `SimulationPlan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPnl` to the `SimulationPlan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPositions` to the `SimulationPlan` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "avgCollateral" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgDuration" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgLeverage" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgNegativePnl" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgPnl" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgPnlPercentageByCollateral" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgPnlPercentageBySize" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgPositivePnl" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "avgSize" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "maxDuration" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "openedPositions" INTEGER NOT NULL,
ADD COLUMN     "totalPnl" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "totalPositions" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "SimulationPlan" ADD COLUMN     "openedPositions" INTEGER NOT NULL,
ADD COLUMN     "totalPnl" INTEGER NOT NULL,
ADD COLUMN     "totalPositions" INTEGER NOT NULL;
