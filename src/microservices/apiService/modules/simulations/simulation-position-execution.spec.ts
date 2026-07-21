import { describe, expect, it } from '@jest/globals';
import { BotMode } from 'generated/prisma/enums';
import {
  calculateFollowerPositionSizing,
  SimulationExecutionBot,
} from './simulation-position-execution';

const bot: SimulationExecutionBot = {
  mode: BotMode.Reversed,
  ratio: 0.1,
  minCollateral: 50,
  maxCollateral: 150,
  minSize: 1500,
  maxSize: 3000,
  minLeverage: 18,
  maxLeverage: 25,
  followerRiskSize: [{ min: 50, max: 500 }],
  followerRiskCollateral: [{ min: 10, max: 100 }],
};

describe('calculateFollowerPositionSizing', () => {
  it('clones the leader opening at the configured ratio and leverage', () => {
    expect(
      calculateFollowerPositionSizing(
        { sizeInUsd: 2000, collateralInUsd: 100, leverage: 20 },
        bot,
      ),
    ).toMatchObject({ sizeUsd: 200, collateralUsd: 10, leverage: 20 });
  });

  it('rejects a leader position outside the execution universe', () => {
    expect(
      calculateFollowerPositionSizing(
        { sizeInUsd: 1000, collateralInUsd: 100, leverage: 10 },
        bot,
      ),
    ).toBeNull();
  });

  it('ignores a position outside the follower opening limits', () => {
    expect(
      calculateFollowerPositionSizing(
        { sizeInUsd: 2000, collateralInUsd: 100, leverage: 20 },
        {
          ...bot,
          ratio: 0.01,
        },
      ),
    ).toBeNull();
  });
});
