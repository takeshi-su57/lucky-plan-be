/*
  Warnings:

  - You are about to drop the column `leaderCollateralBaseline` on the `Bot` table. All the data in the column will be lost.
  - You are about to drop the column `mode` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the column `simulationCursor` on the `Plan` table. All the data in the column will be lost.
  - You are about to drop the `SimulationProgressLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SimulationProgressLog" DROP CONSTRAINT "SimulationProgressLog_planId_fkey";

-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "leaderCollateralBaseline";

-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "mode",
DROP COLUMN "simulationCursor";

-- DropTable
DROP TABLE "SimulationProgressLog";

-- DropEnum
DROP TYPE "PlanMode";

-- CreateTable
CREATE TABLE "SimulationPlan" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "cursor" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationBot" (
    "id" SERIAL NOT NULL,
    "leaderAddress" VARCHAR(255) NOT NULL,
    "strategyId" INTEGER NOT NULL,
    "leaderContractId" INTEGER NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "planId" INTEGER NOT NULL DEFAULT 0,
    "mode" "BotMode" NOT NULL DEFAULT 'Default',

    CONSTRAINT "SimulationBot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SimulationBot" ADD CONSTRAINT "SimulationBot_leaderContractId_fkey" FOREIGN KEY ("leaderContractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationBot" ADD CONSTRAINT "SimulationBot_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SimulationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationBot" ADD CONSTRAINT "SimulationBot_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
