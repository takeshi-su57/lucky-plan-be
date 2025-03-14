-- CreateEnum
CREATE TYPE "AccountPermission" AS ENUM ('Admin', 'Trader', 'Trial');

-- CreateTable
CREATE TABLE "Account" (
    "id" VARCHAR(255) NOT NULL,
    "mnemonic" TEXT NOT NULL,
    "permission" "AccountPermission" NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
