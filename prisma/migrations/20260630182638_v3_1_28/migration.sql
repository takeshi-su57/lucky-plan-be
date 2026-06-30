/*
  Warnings:

  - You are about to drop the column `logKey` on the `Log` table. All the data in the column will be lost.
  - You are about to drop the column `parentSlug` on the `Log` table. All the data in the column will be lost.
  - You are about to drop the column `slug` on the `Log` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Log` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Log_logKey_timestamp_id_idx";

-- DropIndex
DROP INDEX "Log_parentSlug_timestamp_id_idx";

-- DropIndex
DROP INDEX "Log_slug_timestamp_id_idx";

-- AlterTable
ALTER TABLE "Log" DROP COLUMN "logKey",
DROP COLUMN "parentSlug",
DROP COLUMN "slug",
DROP COLUMN "status";

-- DropEnum
DROP TYPE "LogStatus";
