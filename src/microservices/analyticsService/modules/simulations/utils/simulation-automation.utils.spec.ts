import { describe, expect, it } from '@jest/globals';
import { BotMode } from 'generated/prisma/enums';

import {
  calculateLeaderScore,
  getScoreFormular,
  getSizingFormular,
  suggestPositionSizing,
} from './simulation-automation.utils';
import {
  SimulationScoreFormular,
  SimulationSizingFormular,
} from 'src/microservices/apiService/modules/simulations/simulation-formulars';

describe('simulation automation formula registries', () => {
  it('resolves named score and sizing formulars while keeping default behavior', () => {
    const scoreInput = {
      direction: BotMode.Default,
      rawSlope: 50,
      rawR2: 1,
      rawTradeCount: 12,
      copiedNetPnlUsd: 500,
      copiedSlope: 50,
      copiedR2: 1,
      copiedMaxDrawdownUsd: 20,
      copiedProfitFactor: 3,
      totalCostUsd: 10,
      grossProfitUsd: 500,
      topTradeProfitUsd: 100,
      minTrades: 3,
      maxCopiedDrawdownUsd: 500,
    };
    const sizingInput = {
      score: 0.75,
      standardCollateralUsd: 100,
      minCollateralUsd: 10,
      maxCollateralUsd: 500,
      leaderAvgCollateralUsd: 50,
      minRatio: 0,
      maxRatio: 5,
    };

    expect(
      getScoreFormular(SimulationScoreFormular.RiskAdjustedCopyScore)(
        scoreInput,
      ),
    ).toBe(calculateLeaderScore(scoreInput));
    expect(
      getSizingFormular(SimulationSizingFormular.ScoreScaledCollateralSizing)(
        sizingInput,
      ),
    ).toEqual(suggestPositionSizing(sizingInput));
  });

  it('falls back to default formulars when a stored name is unknown', () => {
    expect(getScoreFormular('experimental-missing')).toBe(
      getScoreFormular(SimulationScoreFormular.RiskAdjustedCopyScore),
    );
    expect(getSizingFormular('experimental-missing')).toBe(
      getSizingFormular(SimulationSizingFormular.ScoreScaledCollateralSizing),
    );
  });
});
