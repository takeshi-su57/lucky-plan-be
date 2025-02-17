-- CreateTable
CREATE TABLE "BacktestStore" (
    "id" SERIAL NOT NULL,
    "params" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestStore_pkey" PRIMARY KEY ("id")
);
