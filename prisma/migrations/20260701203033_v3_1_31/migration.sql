/*
  Warnings:

  - You are about to drop the column `maxLeverage` on the `Simulation` table. All the data in the column will be lost.
  - The `score` column on the `Simulation` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `maxLeverage` on the `SimulationResearch` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[simulationPlanId,leaderAddress,leaderPlatform,mode,ratio,minLeverage,maxLeverage]` on the table `SimulationBot` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "SimulationBot_simulationPlanId_leaderAddress_leaderPlatform_key";

-- AlterTable
ALTER TABLE "Simulation" DROP COLUMN "maxLeverage",
ADD COLUMN     "leverage" JSONB NOT NULL DEFAULT '{"min":0,"max":50}',
DROP COLUMN "score",
ADD COLUMN     "score" JSONB NOT NULL DEFAULT '{"min":0,"max":1}';

-- AlterTable
ALTER TABLE "SimulationBot" ADD COLUMN     "minLeverage" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SimulationResearch" DROP COLUMN "maxLeverage",
ADD COLUMN     "leverage" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "SimulationBot_simulationPlanId_leaderAddress_leaderPlatform_key" ON "SimulationBot"("simulationPlanId", "leaderAddress", "leaderPlatform", "mode", "ratio", "minLeverage", "maxLeverage");
