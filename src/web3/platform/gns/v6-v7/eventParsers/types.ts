import { Address } from 'viem';
import { TradeEvent } from 'src/types';

export type LegacyTrade = {
  trader: Address;
  pairIndex: bigint;
  index: bigint;
  initialPosToken: bigint;
  positionSizeDai: bigint;
  openPrice: bigint;
  buy: boolean;
  leverage: bigint;
  tp: bigint;
  sl: bigint;
};

export type LegacyExecutionArgs = {
  orderId: bigint;
  t: LegacyTrade;
  price: bigint;
  priceImpactP: bigint;
  positionSizeDai: bigint;
  percentProfit: bigint;
  daiSentToTrader: bigint;
  collateralPriceUsd?: bigint;
};

export type LegacyMarketExecutedArgs = LegacyExecutionArgs & {
  open: boolean;
};

export type LegacyLimitExecutedArgs = LegacyExecutionArgs & {
  limitIndex: bigint;
  nftHolder: Address;
  orderType: number;
  exactExecution?: boolean;
};

export type LegacyMarketExecutedEvent = TradeEvent<LegacyMarketExecutedArgs>;
export type LegacyLimitExecutedEvent = TradeEvent<LegacyLimitExecutedArgs>;
export type LegacyRegisteredEvent =
  | LegacyMarketExecutedEvent
  | LegacyLimitExecutedEvent;
