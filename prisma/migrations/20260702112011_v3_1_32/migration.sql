-- AlterTable
ALTER TABLE "Simulation" ADD COLUMN     "scoreFormular" TEXT NOT NULL DEFAULT 'RiskAdjustedCopyScore',
ADD COLUMN     "sizingFormular" TEXT NOT NULL DEFAULT 'ScoreScaledCollateralSizing';

-- AlterTable
ALTER TABLE "SimulationResearch" ADD COLUMN     "scoreFormular" TEXT NOT NULL DEFAULT 'RiskAdjustedCopyScore',
ADD COLUMN     "sizingFormular" TEXT NOT NULL DEFAULT 'ScoreScaledCollateralSizing';
