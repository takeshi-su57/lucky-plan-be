-- AlterTable
ALTER TABLE "RpcEndpoint" ADD COLUMN     "lastCheckError" TEXT,
ADD COLUMN     "lastCheckErrorKind" TEXT,
ADD COLUMN     "lastCheckLatencyMs" INTEGER,
ADD COLUMN     "lastCheckOk" BOOLEAN,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

