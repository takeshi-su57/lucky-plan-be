/*
  Warnings:

  - A unique constraint covering the columns `[platform,dateStr]` on the table `PnlSnapshotV2InitializedFlag` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `platform` to the `PnlSnapshotV2InitializedFlag` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "PnlSnapshotV2InitializedFlag_dateStr_key";

-- AlterTable
ALTER TABLE "PnlSnapshotV2InitializedFlag" ADD COLUMN     "platform" "Platform" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshotV2InitializedFlag_platform_dateStr_key" ON "PnlSnapshotV2InitializedFlag"("platform", "dateStr");
