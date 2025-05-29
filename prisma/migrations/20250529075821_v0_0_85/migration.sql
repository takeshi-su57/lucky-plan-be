/*
  Warnings:

  - The values [TWO_DAY,THREE_DAY,TWO_WEEK,HALF_YEAR,YEAR] on the enum `PnlSnapshotKind` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PnlSnapshotKind_new" AS ENUM ('DAY', 'WEEK', 'MONTH', 'THREE_MONTH', 'ALL_TIME');
ALTER TABLE "PnlSnapshot" ALTER COLUMN "kind" TYPE "PnlSnapshotKind_new" USING ("kind"::text::"PnlSnapshotKind_new");
ALTER TYPE "PnlSnapshotKind" RENAME TO "PnlSnapshotKind_old";
ALTER TYPE "PnlSnapshotKind_new" RENAME TO "PnlSnapshotKind";
DROP TYPE "PnlSnapshotKind_old";
COMMIT;

-- AlterTable
ALTER TABLE "_TagToWalletAccount" ADD CONSTRAINT "_TagToWalletAccount_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_TagToWalletAccount_AB_unique";
