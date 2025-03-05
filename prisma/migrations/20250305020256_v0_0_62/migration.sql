-- CreateEnum
CREATE TYPE "LogSeverity" AS ENUM ('Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug', 'Default');

-- CreateTable
CREATE TABLE "Log" (
    "id" SERIAL NOT NULL,
    "severity" "LogSeverity" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,
    "details" TEXT,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);
