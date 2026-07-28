/*
  Warnings:

  - You are about to drop the `Log` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Log";

-- CreateTable
CREATE TABLE "LogReview" (
    "weekStart" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT NOT NULL,

    CONSTRAINT "LogReview_pkey" PRIMARY KEY ("weekStart")
);

-- CreateTable
CREATE TABLE "LegacyLog" (
    "id" INTEGER NOT NULL,
    "severity" "LogSeverity" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "checked" BOOLEAN NOT NULL,

    CONSTRAINT "LegacyLog_pkey" PRIMARY KEY ("id")
);
