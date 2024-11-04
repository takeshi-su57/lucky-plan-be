/*
  Warnings:

  - A unique constraint covering the columns `[missionId,actionId]` on the table `Task` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `positionId` to the `Action` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "positionId" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Task_missionId_actionId_key" ON "Task"("missionId", "actionId");

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
