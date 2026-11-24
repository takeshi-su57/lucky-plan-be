import { describe, expect, it } from '@jest/globals';

import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

import {
  GnsPairRegistry,
  getGnsPairName,
  getGnsSnapshotPairCount,
  gnsPairRegistry,
  isUnknownGnsPairName,
  resolveGnsPairName,
  unknownGnsPairName,
} from './pair-registry';
import { Pair } from './v10/types';
import { gnsPairsSnapshot } from './configs';
import { eventToPerpTradeHistory as marketExecutedToHistory } from './v10/eventParsers/market-executed.parser';
import { eventToPerpTradeHistory as leverageUpdateToHistory } from './v10/eventParsers/leverage-update-executed.parser';
import { getPairName as getV9PairName } from './v9/configs';

const ARBITRUM = 42161;

function pair(pairIndex: number, from: string, to = 'USD'): Pair {
  return {
    pairIndex,
    from,
    to,
    feed: {
      feed1: '0x0000000000000000000000000000000000000000',
      feed2: '0x0000000000000000000000000000000000000000',
      feedCalculation: 0,
      maxDeviationP: 0n,
    },
    spreadP: 0n,
    groupIndex: 0n,
    feeIndex: 0n,
  };
}

// Real Arbitrum close (trader 0x418d…, trade index 2) with the pair index
// swapped per test.
function marketClose(pairIndex: number) {
  return {
    eventName: 'MarketExecuted',
    args: {
      user: '0x418Ddb890F75233944C0C1213b3CAE268B7eEfaf',
      index: 2,
      orderId: { user: '0x418Ddb890F75233944C0C1213b3CAE268B7eEfaf', index: 7 },
      t: {
        user: '0x418Ddb890F75233944C0C1213b3CAE268B7eEfaf',
        index: 2,
        pairIndex,
        leverage: 4000,
        long: false,
        isOpen: true,
        collateralIndex: 3,
        tradeType: 0,
        collateralAmount: '200000000',
        openPrice: '42764',
        tp: '32062',
        sl: '51840',
        isCounterTrade: true,
        positionSizeToken: '187086363742662706671967446',
        __placeholder: 0,
      },
      open: false,
      oraclePrice: '40282',
      marketPrice: '40280',
      liqPrice: '52513',
      percentProfit: '232344963053',
      amountSentToTrader: '248854892',
      collateralPriceUsd: '99988279',
    },
  } as never;
}

function leverageUpdate(cancelReason: number) {
  return {
    eventName: 'LeverageUpdateExecuted',
    args: {
      collateralIndex: 3,
      trader: '0x418Ddb890F75233944C0C1213b3CAE268B7eEfaf',
      index: '23',
      isIncrease: false,
      cancelReason,
      pairIndex: '104',
      oraclePrice: '51382000000',
      collateralDelta: '99962179',
      values: {
        newLeverage: '2533',
        newCollateralAmount: '272562179',
      },
    },
  } as never;
}

describe('GnsPairRegistry', () => {
  it('registers pairs, tracks the contiguous count and handles renames', () => {
    const registry = new GnsPairRegistry();

    expect(registry.knownCount(1)).toBe(0);

    registry.register(1, [pair(0, 'BTC'), pair(1, 'ETH'), pair(3, 'SOL')]);
    expect(registry.knownCount(1)).toBe(2);
    expect(registry.getByName(1, 'eth/usd')?.pairIndex).toBe(1);

    expect(registry.register(1, [pair(1, 'ETH')])).toBe(0);
    expect(registry.register(1, [pair(1, 'ETHX')])).toBe(1);
    expect(registry.getByName(1, 'eth/usd')).toBeNull();
    expect(registry.get(1, 1)?.from).toBe('ETHX');

    expect(registry.pairsFrom(1, 1).map((item) => item.pairIndex)).toEqual([
      1, 3,
    ]);
  });

  it('is seeded from the bundled snapshot and shared by every GNS version', () => {
    expect(getGnsSnapshotPairCount(ARBITRUM)).toBeGreaterThan(400);
    expect(getGnsPairName(ARBITRUM, 0)).toBe('btc/usd');
    expect(getV9PairName(ARBITRUM, 453)).toBe(getGnsPairName(ARBITRUM, 453));
  });

  it('returns a placeholder for pairs it does not know yet', () => {
    expect(resolveGnsPairName(ARBITRUM, 99_999)).toBe(
      unknownGnsPairName(99_999),
    );
    expect(isUnknownGnsPairName(unknownGnsPairName(99_999))).toBe(true);
    expect(isUnknownGnsPairName('btc/usd')).toBe(false);
  });
});

describe('GNS v10 parsers', () => {
  it('keeps trades on unknown pairs and names them once the pair is synced', () => {
    const before = marketExecutedToHistory(ARBITRUM, marketClose(99_998));

    expect(before).not.toBeNull();
    expect(before?.pair).toBe(unknownGnsPairName(99_998));
    expect(before?.operation).toBe(PerpTradeHistoryOperation.CLOSE);
    expect(before?.usdPnl).toBeCloseTo(48.849, 2);

    gnsPairRegistry.register(ARBITRUM, [pair(99_998, 'NEWCOIN')]);

    expect(marketExecutedToHistory(ARBITRUM, marketClose(99_998))?.pair).toBe(
      'newcoin/usd',
    );
  });

  it('ignores cancelled leverage updates', () => {
    expect(leverageUpdateToHistory(ARBITRUM, leverageUpdate(0))).not.toBeNull();
    expect(leverageUpdateToHistory(ARBITRUM, leverageUpdate(2))).toBeNull();
  });
});

describe('GNS committed snapshot', () => {
  it('stores pairs at their pairIndex with no gaps', () => {
    for (const [chainId, pairs] of Object.entries(gnsPairsSnapshot)) {
      pairs.forEach((item, index) => expect(item.pairIndex).toBe(index));
      expect(
        gnsPairRegistry.knownCount(Number(chainId)),
      ).toBeGreaterThanOrEqual(pairs.length);
    }
  });
});
