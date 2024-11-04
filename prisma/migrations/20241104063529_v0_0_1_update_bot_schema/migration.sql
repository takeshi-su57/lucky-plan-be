-- AlterEnum
ALTER TYPE "BotStatus" ADD VALUE 'Created';

-- AlterTable
ALTER TABLE "Bot" ALTER COLUMN "startedBlock" DROP NOT NULL,
ALTER COLUMN "pausedBlock" DROP NOT NULL,
ALTER COLUMN "endedBlock" DROP NOT NULL;
