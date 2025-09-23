-- CreateTable
CREATE TABLE "JupPerpEventLog" (
    "id" SERIAL NOT NULL,
    "jsonLog" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JupPerpEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JupPerpEventLog_signature_idx" ON "JupPerpEventLog"("signature");
