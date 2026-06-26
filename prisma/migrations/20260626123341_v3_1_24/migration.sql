-- AlterTable
ALTER TABLE "SimulationBotCache" ADD COLUMN     "followerPositionPnlsJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "positionsJson" TEXT NOT NULL DEFAULT '[]';
