-- AlterTable
ALTER TABLE "BacktestTask" ADD COLUMN     "currentTrial" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastHeartbeat" TIMESTAMP(3),
ADD COLUMN     "trialProgress" TEXT;
