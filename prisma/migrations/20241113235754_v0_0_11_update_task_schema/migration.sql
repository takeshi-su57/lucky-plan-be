/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `Task` table. All the data in the column will be lost.
  - Added the required column `logs` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "updatedAt",
ADD COLUMN     "logs" TEXT NOT NULL;
