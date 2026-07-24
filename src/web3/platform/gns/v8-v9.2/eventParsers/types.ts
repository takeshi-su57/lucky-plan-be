import { Address } from 'viem';
import { TradeEvent } from 'src/types';

type Numeric = bigint | number;

export type EarlyDiamondId = {
  user: Address;
  index: Numeric;
};

export type EarlyDiamondTrade = {
  user: Address;
  index: Numeric;
  pairIndex: Numeric;
  leverage: Numeric;
  long: boolean;
  isOpen: boolean;
  collateralIndex: Numeric;
  tradeType: Numeric;
  collateralAmount: bigint;
  openPrice: Numeric;
  tp: Numeric;
  sl: Numeric;
  __placeholder: bigint;
};

export type EarlyDiamondExecutionArgs = {
  orderId: EarlyDiamondId;
  t: EarlyDiamondTrade;
  price: bigint;
  priceImpactP: bigint;
  percentProfit: bigint;
  amountSentToTrader: bigint;
  collateralPriceUsd: bigint;
};

export type EarlyDiamondMarketExecutedArgs = EarlyDiamondExecutionArgs & {
  open: boolean;
};

export type EarlyDiamondLimitExecutedArgs = EarlyDiamondExecutionArgs & {
  triggerCaller: Address;
  orderType: Numeric;
  exactExecution: boolean;
};

export type V92PartialBaseArgs = {
  orderId: EarlyDiamondId;
  cancelReason: Numeric;
  collateralIndex: Numeric;
  trader: Address;
  pairIndex: Numeric;
  index: Numeric;
  marketPrice: bigint;
  collateralDelta: bigint;
  leverageDelta: bigint;
  long?: boolean;
  collateralPriceUsd?: bigint;
};

export type V92IncreaseValues = {
  positionSizeCollateralDelta: bigint;
  existingPositionSizeCollateral: bigint;
  newPositionSizeCollateral: bigint;
  newCollateralAmount: bigint;
  newLeverage: Numeric;
  priceAfterImpact: bigint;
  existingPnlCollateral: bigint;
  newOpenPrice: bigint;
  borrowingFeeCollateral: bigint;
  openingFeesCollateral: bigint;
  existingLiqPrice: bigint;
  newLiqPrice: bigint;
};

export type V92DecreaseValues = {
  positionSizeCollateralDelta: bigint;
  existingPositionSizeCollateral: bigint;
  existingLiqPrice: bigint;
  priceAfterImpact?: bigint;
  existingPnlCollateral: bigint;
  borrowingFeeCollateral: bigint;
  vaultFeeCollateral: bigint;
  gnsStakingFeeCollateral: bigint;
  availableCollateralInDiamond: bigint;
  collateralSentToTrader: bigint;
  newCollateralAmount: bigint;
  newLeverage: Numeric;
};

export type V92PositionSizeIncreaseArgs = V92PartialBaseArgs & {
  values: V92IncreaseValues;
};

export type V92PositionSizeDecreaseArgs = V92PartialBaseArgs & {
  values: V92DecreaseValues;
};

export type EarlyDiamondMarketExecutedEvent =
  TradeEvent<EarlyDiamondMarketExecutedArgs>;
export type EarlyDiamondLimitExecutedEvent =
  TradeEvent<EarlyDiamondLimitExecutedArgs>;
export type V92PositionSizeIncreaseEvent =
  TradeEvent<V92PositionSizeIncreaseArgs>;
export type V92PositionSizeDecreaseEvent =
  TradeEvent<V92PositionSizeDecreaseArgs>;

export type EarlyDiamondRegisteredEvent =
  | EarlyDiamondMarketExecutedEvent
  | EarlyDiamondLimitExecutedEvent
  | V92PositionSizeIncreaseEvent
  | V92PositionSizeDecreaseEvent;
