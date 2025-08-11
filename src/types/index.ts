import { Address } from 'viem';

import { MarketExecutedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/market-executed.parser';
import { LimitExecutedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/limit-executed.parser';
import { TradeMaxClosingSlippagePUpdatedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/trade-max-closing-slippage-p-updated.parser';
import { LeverageUpdateExecutedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/leverage-update-executed.parser';
import { PositionSizeDecreaseExecutedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/position-size-decrease-executed.parser';
import { PositionSizeIncreaseExecutedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/position-size-increase-executed.parser';
import { MarketOrderInitiatedEvent } from 'src/microservices/apiService/modules/actions/eventParsers/market-order-initiated.parser';

import { MarketOpenCanceledEvent } from 'src/microservices/apiService/modules/actions/eventParsers/market-open-canceled';

import { ActionDetails } from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { BotDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';
import { TaskDetails } from 'src/microservices/apiService/modules/tasks/entities/task.entity';
import { MarketCloseCanceledEvent } from 'src/microservices/apiService/modules/actions/eventParsers/market-close-canceled';
import { MissionDetails } from 'src/microservices/apiService/modules/missions/entities/mission.entity';

export enum TradeType {
  TRADE,
  LIMIT,
  STOP,
}

export enum PendingOrderType {
  MARKET_OPEN,
  MARKET_CLOSE,
  LIMIT_OPEN,
  STOP_OPEN,
  TP_CLOSE,
  SL_CLOSE,
  LIQ_CLOSE,
  UPDATE_LEVERAGE,
  MARKET_PARTIAL_OPEN,
  MARKET_PARTIAL_CLOSE,
}

export enum CancelReason {
  NONE,
  PAUSED, // deprecated
  MARKET_CLOSED,
  SLIPPAGE,
  TP_REACHED,
  SL_REACHED,
  EXPOSURE_LIMITS,
  PRICE_IMPACT,
  MAX_LEVERAGE,
  NO_TRADE,
  WRONG_TRADE, // deprecated
  NOT_HIT,
  LIQ_REACHED,
}

export enum ContractsVersion {
  BEFORE_V9_2,
  V9_2,
}

export type Pair = {
  from: string;
  to: string;
  feed: {
    feed1: Address;
    feed2: Address;
    feedCalculation: number;
    maxDeviationP: bigint;
  };
  depth: {
    onePercentDepthAboveUsd: bigint;
    onePercentDepthBelowUsd: bigint;
  };
  spreadP: bigint;
  groupIndex: bigint;
  feeIndex: bigint;
};

export type Collateral = {
  collateral: Address;
  isActive: boolean;
  precision: bigint;
  precisionDelta: bigint;
  __placeholder: bigint;
};

export type Id = {
  user: Address;
  index: number;
};

export type Trade = {
  user: Address;
  index: number;
  pairIndex: number;
  leverage: number;
  long: boolean;
  isOpen: boolean;
  collateralIndex: number;
  tradeType: TradeType;
  collateralAmount: bigint;
  openPrice: bigint;
  tp: bigint;
  sl: bigint;
  __placeholder: bigint;
};

export type TradeInfo = {
  createdBlock: number;
  tpLastUpdatedBlock: number;
  slLastUpdatedBlock: number;
  maxSlippageP: number;
  lastOiUpdateTs: number;
  collateralPriceUsd: number;
  contractsVersion: ContractsVersion;
  lastPosIncreaseBlock: number;
  __placeholder: number;
};

export type TradeEvent<T> = {
  eventName: string;
  args: T;
};

export type MissionEventType =
  | MarketExecutedEvent
  | LimitExecutedEvent
  | MarketOrderInitiatedEvent;
export type TaskEventType =
  | TradeMaxClosingSlippagePUpdatedEvent
  | LeverageUpdateExecutedEvent
  | PositionSizeDecreaseExecutedEvent
  | PositionSizeIncreaseExecutedEvent;
export type TrackEventType =
  | MarketOrderInitiatedEvent
  | MarketOpenCanceledEvent
  | MarketCloseCanceledEvent;

export type RegisteredEventType =
  | MissionEventType
  | TaskEventType
  | TrackEventType;

export type BotContext = {
  bot: BotDetails;
};

export type MissionContext = BotContext & {
  mission: MissionDetails;
};

export type TaskContext = MissionContext & {
  task: TaskDetails;
};

export type ActionContext<T> = {
  action: ActionDetails;
  context: T;
};

export type TradeEventContext<TEventArgs, TContext> = {
  action: ActionDetails;
  event: TradeEvent<TEventArgs>;
  context: TContext;
};

export type CloseMissionActionArgs = {
  expectedPrice: string;
};

export enum ServiceStatus {
  KILLED = 'killed',
  PROCESS = 'process',
  READY = 'ready',
}

export type EncryptedData = {
  ivHex: string;
  encrypted: string;
};

export type TradingVariable = {
  pairs: (Pair | undefined)[];
  collaterals: Collateral[];
};
