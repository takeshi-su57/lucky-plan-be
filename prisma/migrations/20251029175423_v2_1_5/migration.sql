-- CreateTable
CREATE TABLE "TradingSignalLog" (
    "id" SERIAL NOT NULL,
    "platform" "Platform" NOT NULL,
    "address" TEXT NOT NULL,
    "eventLogIds" INTEGER[],

    CONSTRAINT "TradingSignalLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradingSignalLog_platform_address_key" ON "TradingSignalLog"("platform", "address");
