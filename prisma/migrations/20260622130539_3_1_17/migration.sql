/*
  Warnings:

  - You are about to drop the column `strategyId` on the `SimulationBot` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "SimulationBot" DROP CONSTRAINT "SimulationBot_strategyId_fkey";

-- AlterTable
ALTER TABLE "SimulationBot" DROP COLUMN "strategyId";
