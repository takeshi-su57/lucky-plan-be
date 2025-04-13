-- CreateTable
CREATE TABLE "TestingReportV2" (
    "id" SERIAL NOT NULL,
    "minSlope" INTEGER NOT NULL,
    "maxSlope" INTEGER NOT NULL,
    "r2MinsByPnlSnapshotKind" TEXT NOT NULL,
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

    CONSTRAINT "TestingReportV2_pkey" PRIMARY KEY ("id")
);
