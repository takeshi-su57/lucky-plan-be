/*
  Warnings:

  - A unique constraint covering the columns `[dateStr]` on the table `PnlSnapshotInitializedFlag` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "PnlSnapshotInitializedFlag_dateStr_key" ON "PnlSnapshotInitializedFlag"("dateStr");
