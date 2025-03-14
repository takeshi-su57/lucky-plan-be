/*
  Warnings:

  - You are about to drop the `Account` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "UserPermission" AS ENUM ('Admin', 'Trader', 'Trial');

-- DropTable
DROP TABLE "Account";

-- DropEnum
DROP TYPE "AccountPermission";

-- CreateTable
CREATE TABLE "User" (
    "address" TEXT NOT NULL,
    "mnemonic" TEXT NOT NULL,
    "permission" "UserPermission" NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");
