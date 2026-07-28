export type NumericValue = bigint | string | number;

export type GmxV1PositionEventArgs = {
  key: `0x${string}`;
  positionKey: `0x${string}`;
  account: `0x${string}`;
  collateralToken: `0x${string}`;
  indexToken: `0x${string}`;
  collateralDelta: NumericValue;
  sizeDelta: NumericValue;
  isLong: boolean;
  price: NumericValue;
  executionPrice: NumericValue;
  fee: NumericValue;
  feeUsd: NumericValue;
  sizeInUsd: NumericValue;
  collateralInUsd: NumericValue;
  basePnlUsd: NumericValue;
  averagePrice: NumericValue;
  entryFundingRate: NumericValue;
  reserveAmount: NumericValue;
  realisedPnl: NumericValue;
  markPrice: NumericValue;
  stateEventName?: 'UpdatePosition' | 'ClosePosition';
  liquidationCollateral?: NumericValue;
};

export type GmxV1PositionEvent<TEventName extends string> = {
  eventName: TEventName;
  args: GmxV1PositionEventArgs;
};

export type DecodedEvent = {
  eventName: string;
  args: Record<string, unknown>;
};

export type GmxV1LogEnvelope = {
  eventLog: DecodedEvent;
  blockNumber: number;
  logIndex: number;
  transactionHash?: string;
  txHash?: string | null;
  blockHash?: string | null;
};
