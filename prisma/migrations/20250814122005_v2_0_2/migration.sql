/*
  Warnings:

  - A unique constraint covering the columns `[chainId,address,version,platform]` on the table `Contract` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Contract_chainId_address_key";

-- CreateIndex
CREATE UNIQUE INDEX "Contract_chainId_address_version_platform_key" ON "Contract"("chainId", "address", "version", "platform");
