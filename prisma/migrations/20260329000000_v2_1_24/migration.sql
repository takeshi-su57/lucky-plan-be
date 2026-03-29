-- AlterTable
ALTER TABLE "User" ADD COLUMN "secondAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_secondAddress_key" ON "User"("secondAddress");
