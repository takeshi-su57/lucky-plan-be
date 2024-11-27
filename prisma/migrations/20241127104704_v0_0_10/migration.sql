/*
  Warnings:

  - The values [Finish] on the enum `BotStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `pausedBlock` on the `Bot` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "BotStatus_new" AS ENUM ('Created', 'Live', 'SoftStop', 'HardStop', 'Dead');
ALTER TABLE "Bot" ALTER COLUMN "status" TYPE "BotStatus_new" USING ("status"::text::"BotStatus_new");
ALTER TYPE "BotStatus" RENAME TO "BotStatus_old";
ALTER TYPE "BotStatus_new" RENAME TO "BotStatus";
DROP TYPE "BotStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "Bot" DROP COLUMN "pausedBlock";
