import { Address } from 'viem';

export enum TradeType {
  TRADE,
  LIMIT,
  STOP,
}

export enum ContractsVersion {
  BEFORE_V9_2,
  V9_2,
}

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
