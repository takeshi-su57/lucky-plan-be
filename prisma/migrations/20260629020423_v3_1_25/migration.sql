-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "direction" "BotMode" NOT NULL DEFAULT 'Reversed',
ADD COLUMN     "maxR2" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "maxSlope" DOUBLE PRECISION NOT NULL DEFAULT 999999,
ADD COLUMN     "maxTrades" INTEGER NOT NULL DEFAULT 999999,
ADD COLUMN     "minR2" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
ADD COLUMN     "minSlope" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "researchId" INTEGER;

-- CreateTable
CREATE TABLE "SimulationResearch" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "direction" "BotMode" NOT NULL DEFAULT 'Reversed',
    "minTradesMin" INTEGER NOT NULL,
    "minTradesMax" INTEGER NOT NULL,
    "minTradesGap" INTEGER NOT NULL,
    "maxTradesMin" INTEGER NOT NULL,
    "maxTradesMax" INTEGER NOT NULL,
    "maxTradesGap" INTEGER NOT NULL,
    "minR2Min" DOUBLE PRECISION NOT NULL,
    "minR2Max" DOUBLE PRECISION NOT NULL,
    "minR2Gap" DOUBLE PRECISION NOT NULL,
    "maxR2Min" DOUBLE PRECISION NOT NULL,
    "maxR2Max" DOUBLE PRECISION NOT NULL,
    "maxR2Gap" DOUBLE PRECISION NOT NULL,
    "minSlopeMin" DOUBLE PRECISION NOT NULL,
    "minSlopeMax" DOUBLE PRECISION NOT NULL,
    "minSlopeGap" DOUBLE PRECISION NOT NULL,
    "maxSlopeMin" DOUBLE PRECISION NOT NULL,
    "maxSlopeMax" DOUBLE PRECISION NOT NULL,
    "maxSlopeGap" DOUBLE PRECISION NOT NULL,
    "maxLeverageMin" DOUBLE PRECISION NOT NULL,
    "maxLeverageMax" DOUBLE PRECISION NOT NULL,
    "maxLeverageGap" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationResearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationResearch_createdAt_idx" ON "SimulationResearch"("createdAt");

-- CreateIndex
CREATE INDEX "Simulation_researchId_createdAt_idx" ON "Simulation"("researchId", "createdAt");

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_researchId_fkey" FOREIGN KEY ("researchId") REFERENCES "SimulationResearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
