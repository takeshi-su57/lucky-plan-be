-- DropForeignKey
ALTER TABLE "SimulationBot" DROP CONSTRAINT "SimulationBot_strategyId_fkey";

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "ratio" DOUBLE PRECISION NOT NULL DEFAULT 1,
ALTER COLUMN "strategyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SimulationBot" ADD CONSTRAINT "SimulationBot_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
