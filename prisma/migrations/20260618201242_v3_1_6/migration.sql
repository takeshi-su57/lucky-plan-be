/*
  Warnings:

  - The values [Hook] on the enum `MissionMode` will be removed. If these variants are still used in the database, this will fail.
  - The `mode` column on the `Strategy` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "StrategyMode" AS ENUM ('Default', 'Signal');

-- CreateEnum
CREATE TYPE "PlanMode" AS ENUM ('Live', 'Simulation');

-- AlterEnum
BEGIN;
CREATE TYPE "MissionMode_new" AS ENUM ('Default', 'Signal');
ALTER TABLE "public"."Mission" ALTER COLUMN "mode" DROP DEFAULT;
ALTER TABLE "Mission" ALTER COLUMN "mode" TYPE "MissionMode_new" USING ("mode"::text::"MissionMode_new");
ALTER TYPE "MissionMode" RENAME TO "MissionMode_old";
ALTER TYPE "MissionMode_new" RENAME TO "MissionMode";
DROP TYPE "public"."MissionMode_old";
ALTER TABLE "Mission" ALTER COLUMN "mode" SET DEFAULT 'Default';
COMMIT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "mode" "PlanMode" NOT NULL DEFAULT 'Live';

-- AlterTable
ALTER TABLE "Strategy" DROP COLUMN "mode",
ADD COLUMN     "mode" "StrategyMode" NOT NULL DEFAULT 'Default';
