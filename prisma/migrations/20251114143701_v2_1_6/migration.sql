-- CreateEnum
CREATE TYPE "MissionMode" AS ENUM ('Default', 'Signal');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "mode" "MissionMode" NOT NULL DEFAULT 'Default';
