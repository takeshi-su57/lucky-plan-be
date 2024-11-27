-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('Live', 'Dead');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "status" "ContractStatus" NOT NULL DEFAULT 'Live';
