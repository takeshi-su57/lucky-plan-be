/*
  Warnings:

  - You are about to drop the column `leaderContractId` on the `SimulationBot` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[simulationPlanId,leaderAddress,leaderPlatform,mode,ratio,maxLeverage]` on the table `SimulationBot` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `leaderPlatform` to the `SimulationBot` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "SimulationBot" DROP CONSTRAINT "SimulationBot_leaderContractId_fkey";

-- AlterTable
ALTER TABLE "SimulationBot" DROP COLUMN "leaderContractId",
ADD COLUMN     "leaderPlatform" "Platform" NOT NULL;

-- CreateIndex
CREATE INDEX "SimulationBot_leaderPlatform_leaderAddress_idx" ON "SimulationBot"("leaderPlatform", "leaderAddress");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBot_simulationPlanId_leaderAddress_leaderPlatform_key" ON "SimulationBot"("simulationPlanId", "leaderAddress", "leaderPlatform", "mode", "ratio", "maxLeverage");
