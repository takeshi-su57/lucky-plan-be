/*
  Warnings:

  - Added the required column `status` to the `Mission` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('Opened', 'Closed');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "status" "MissionStatus" NOT NULL;
