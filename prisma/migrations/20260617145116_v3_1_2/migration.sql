/*
  Warnings:

  - You are about to drop the `TradingSignalLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "BotMode" AS ENUM ('Default', 'Reversed');

-- AlterTable
ALTER TABLE "Bot" ADD COLUMN     "mode" "BotMode" NOT NULL DEFAULT 'Default';

-- DropTable
DROP TABLE "TradingSignalLog";
