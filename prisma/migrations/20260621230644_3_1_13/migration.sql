/*
  Warnings:

  - You are about to drop the column `planId` on the `SimulationBot` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SimulationBot" DROP CONSTRAINT "SimulationBot_planId_fkey";

-- AlterTable
ALTER TABLE "SimulationBot" DROP COLUMN "planId",
ADD COLUMN     "simulationPlanId" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "SimulationBot" ADD CONSTRAINT "SimulationBot_simulationPlanId_fkey" FOREIGN KEY ("simulationPlanId") REFERENCES "SimulationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
