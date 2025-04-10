-- CreateTable
CREATE TABLE "TestingReportV4" (
    "id" SERIAL NOT NULL,
    "minSize" INTEGER NOT NULL,
    "maxSize" INTEGER NOT NULL,
    "minCount" INTEGER NOT NULL,
    "maxCount" INTEGER NOT NULL,
    "minR2" TEXT NOT NULL,
    "investedUSD" DOUBLE PRECISION NOT NULL,
    "totalUSDPnl" DOUBLE PRECISION NOT NULL,
    "totalTasks" INTEGER NOT NULL,
    "totalPositions" INTEGER NOT NULL,
    "totalTraders" INTEGER NOT NULL,
    "totalUniqueTraders" INTEGER NOT NULL,
    "usdPnls" DOUBLE PRECISION[],
    "calculatedR2" DOUBLE PRECISION NOT NULL,
    "calculatedSlope" DOUBLE PRECISION NOT NULL,
    "maxLoss" DOUBLE PRECISION NOT NULL,
    "lossCount" INTEGER NOT NULL,
    "avgLoss" DOUBLE PRECISION NOT NULL,
    "maxProfit" DOUBLE PRECISION NOT NULL,
    "profitCount" INTEGER NOT NULL,
    "avgProfit" DOUBLE PRECISION NOT NULL,
    "peakAccProfit" DOUBLE PRECISION NOT NULL,
    "bottomAccProfit" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TestingReportV4_pkey" PRIMARY KEY ("id")
);
