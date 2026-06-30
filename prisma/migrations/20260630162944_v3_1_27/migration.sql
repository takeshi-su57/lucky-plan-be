-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('Pending', 'Running', 'Success', 'Failed', 'Cancelled');

-- AlterTable
ALTER TABLE "Log" ADD COLUMN     "logKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "parentSlug" TEXT,
ADD COLUMN     "slug" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "status" "LogStatus" NOT NULL DEFAULT 'Success';

-- CreateIndex
CREATE INDEX "Log_slug_timestamp_id_idx" ON "Log"("slug", "timestamp" DESC, "id");

-- CreateIndex
CREATE INDEX "Log_parentSlug_timestamp_id_idx" ON "Log"("parentSlug", "timestamp" DESC, "id");

-- CreateIndex
CREATE INDEX "Log_logKey_timestamp_id_idx" ON "Log"("logKey", "timestamp" DESC, "id");
