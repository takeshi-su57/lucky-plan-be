const idComponents = [
  { internalType: 'address', name: 'user', type: 'address' },
  { internalType: 'uint32', name: 'index', type: 'uint32' },
] as const;

const tradeComponents = [
  { internalType: 'address', name: 'user', type: 'address' },
  { internalType: 'uint32', name: 'index', type: 'uint32' },
  { internalType: 'uint16', name: 'pairIndex', type: 'uint16' },
  { internalType: 'uint24', name: 'leverage', type: 'uint24' },
  { internalType: 'bool', name: 'long', type: 'bool' },
  { internalType: 'bool', name: 'isOpen', type: 'bool' },
  { internalType: 'uint8', name: 'collateralIndex', type: 'uint8' },
  {
    internalType: 'enum ITradingStorage.TradeType',
    name: 'tradeType',
    type: 'uint8',
  },
  { internalType: 'uint120', name: 'collateralAmount', type: 'uint120' },
  { internalType: 'uint64', name: 'openPrice', type: 'uint64' },
  { internalType: 'uint64', name: 'tp', type: 'uint64' },
  { internalType: 'uint64', name: 'sl', type: 'uint64' },
  { internalType: 'uint192', name: '__placeholder', type: 'uint192' },
] as const;

const v9LegacyDecreaseValues = [
  {
    internalType: 'uint256',
    name: 'positionSizeCollateralDelta',
    type: 'uint256',
  },
  {
    internalType: 'uint256',
    name: 'existingPositionSizeCollateral',
    type: 'uint256',
  },
  { internalType: 'uint256', name: 'existingLiqPrice', type: 'uint256' },
  { internalType: 'int256', name: 'existingPnlCollateral', type: 'int256' },
  {
    internalType: 'uint256',
    name: 'borrowingFeeCollateral',
    type: 'uint256',
  },
  { internalType: 'uint256', name: 'vaultFeeCollateral', type: 'uint256' },
  {
    internalType: 'uint256',
    name: 'gnsStakingFeeCollateral',
    type: 'uint256',
  },
  {
    internalType: 'int256',
    name: 'availableCollateralInDiamond',
    type: 'int256',
  },
  {
    internalType: 'int256',
    name: 'collateralSentToTrader',
    type: 'int256',
  },
  { internalType: 'uint120', name: 'newCollateralAmount', type: 'uint120' },
  { internalType: 'uint24', name: 'newLeverage', type: 'uint24' },
] as const;

const v92DecreaseValues = [
  {
    internalType: 'uint256',
    name: 'positionSizeCollateralDelta',
    type: 'uint256',
  },
  {
    internalType: 'uint256',
    name: 'existingPositionSizeCollateral',
    type: 'uint256',
  },
  { internalType: 'uint256', name: 'existingLiqPrice', type: 'uint256' },
  { internalType: 'uint256', name: 'priceAfterImpact', type: 'uint256' },
  { internalType: 'int256', name: 'existingPnlCollateral', type: 'int256' },
  {
    internalType: 'uint256',
    name: 'borrowingFeeCollateral',
    type: 'uint256',
  },
  { internalType: 'uint256', name: 'vaultFeeCollateral', type: 'uint256' },
  {
    internalType: 'uint256',
    name: 'gnsStakingFeeCollateral',
    type: 'uint256',
  },
  {
    internalType: 'int256',
    name: 'availableCollateralInDiamond',
    type: 'int256',
  },
  {
    internalType: 'int256',
    name: 'collateralSentToTrader',
    type: 'int256',
  },
  { internalType: 'uint120', name: 'newCollateralAmount', type: 'uint120' },
  { internalType: 'uint24', name: 'newLeverage', type: 'uint24' },
] as const;

const v9LegacyIncreaseValues = [
  {
    internalType: 'uint256',
    name: 'positionSizeCollateralDelta',
    type: 'uint256',
  },
  {
    internalType: 'uint256',
    name: 'existingPositionSizeCollateral',
    type: 'uint256',
  },
  {
    internalType: 'uint256',
    name: 'newPositionSizeCollateral',
    type: 'uint256',
  },
  { internalType: 'uint256', name: 'newCollateralAmount', type: 'uint256' },
  { internalType: 'uint256', name: 'newLeverage', type: 'uint256' },
  { internalType: 'uint256', name: 'priceAfterImpact', type: 'uint256' },
  { internalType: 'int256', name: 'existingPnlCollateral', type: 'int256' },
  { internalType: 'uint256', name: 'newOpenPrice', type: 'uint256' },
  {
    internalType: 'uint256',
    name: 'borrowingFeeCollateral',
    type: 'uint256',
  },
  {
    internalType: 'uint256',
    name: 'openingFeesCollateral',
    type: 'uint256',
  },
  { internalType: 'uint256', name: 'existingLiqPrice', type: 'uint256' },
  { internalType: 'uint256', name: 'newLiqPrice', type: 'uint256' },
] as const;

const missionOrderId = {
  components: idComponents,
  indexed: false,
  internalType: 'struct ITradingStorage.Id',
  name: 'orderId',
  type: 'tuple',
} as const;

const missionTrade = {
  components: tradeComponents,
  indexed: false,
  internalType: 'struct ITradingStorage.Trade',
  name: 't',
  type: 'tuple',
} as const;

const partialPrefix = [
  missionOrderId,
  {
    indexed: false,
    internalType: 'enum ITradingCallbacks.CancelReason',
    name: 'cancelReason',
    type: 'uint8',
  },
  {
    indexed: true,
    internalType: 'uint8',
    name: 'collateralIndex',
    type: 'uint8',
  },
  {
    indexed: true,
    internalType: 'address',
    name: 'trader',
    type: 'address',
  },
  {
    indexed: true,
    internalType: 'uint256',
    name: 'pairIndex',
    type: 'uint256',
  },
  {
    indexed: false,
    internalType: 'uint256',
    name: 'index',
    type: 'uint256',
  },
] as const;

const partialDeltas = [
  {
    indexed: false,
    internalType: 'uint256',
    name: 'collateralDelta',
    type: 'uint256',
  },
  {
    indexed: false,
    internalType: 'uint256',
    name: 'leverageDelta',
    type: 'uint256',
  },
] as const;

const selfContainedPartialContext = [
  {
    indexed: false,
    internalType: 'bool',
    name: 'long',
    type: 'bool',
  },
  {
    indexed: false,
    internalType: 'uint256',
    name: 'marketPrice',
    type: 'uint256',
  },
  {
    indexed: false,
    internalType: 'uint256',
    name: 'collateralPriceUsd',
    type: 'uint256',
  },
] as const;

/**
 * Minimal historical ABI for the merged diamond before the repository's V9
 * parser range. It includes V8 mission executions plus both early-V9 and V9.2
 * partial-size overloads. The older partial overloads are retained so logs can
 * be decoded, but their parser deliberately returns null because those events
 * omit direction and collateral USD price.
 */
export const gnsV8V92MultiCollatDiamondAbi = [
  {
    anonymous: false,
    inputs: [
      missionOrderId,
      missionTrade,
      { indexed: false, internalType: 'bool', name: 'open', type: 'bool' },
      {
        indexed: false,
        internalType: 'uint64',
        name: 'price',
        type: 'uint64',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'priceImpactP',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'int256',
        name: 'percentProfit',
        type: 'int256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amountSentToTrader',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'collateralPriceUsd',
        type: 'uint256',
      },
    ],
    name: 'MarketExecuted',
    type: 'event',
    signature:
      '0xbbd5cfa7b4ec0d44d4155fcaad32af9cf7e65799d6b8b08f233b930de7bcd9a8',
  },
  {
    anonymous: false,
    inputs: [
      missionOrderId,
      missionTrade,
      {
        indexed: true,
        internalType: 'address',
        name: 'triggerCaller',
        type: 'address',
      },
      {
        indexed: false,
        internalType: 'enum ITradingStorage.PendingOrderType',
        name: 'orderType',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'price',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'priceImpactP',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'int256',
        name: 'percentProfit',
        type: 'int256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amountSentToTrader',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'collateralPriceUsd',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'exactExecution',
        type: 'bool',
      },
    ],
    name: 'LimitExecuted',
    type: 'event',
    signature:
      '0xc10f67c0e22c53149183a414c16a62334103432a2c48b839a057cd9bd5fdeb99',
  },
  {
    anonymous: false,
    inputs: [
      ...partialPrefix,
      {
        indexed: false,
        internalType: 'uint256',
        name: 'marketPrice',
        type: 'uint256',
      },
      ...partialDeltas,
      {
        components: v9LegacyDecreaseValues,
        indexed: false,
        internalType: 'struct IUpdatePositionSize.DecreasePositionSizeValues',
        name: 'values',
        type: 'tuple',
      },
    ],
    name: 'PositionSizeDecreaseExecuted',
    type: 'event',
    signature:
      '0x55eb5f89c70aca28886aa8ef325c490fcde181e2644a29be3ee8e99f0ada207c',
  },
  {
    anonymous: false,
    inputs: [
      ...partialPrefix,
      {
        indexed: false,
        internalType: 'uint256',
        name: 'marketPrice',
        type: 'uint256',
      },
      ...partialDeltas,
      {
        components: v9LegacyIncreaseValues,
        indexed: false,
        internalType: 'struct IUpdatePositionSize.IncreasePositionSizeValues',
        name: 'values',
        type: 'tuple',
      },
    ],
    name: 'PositionSizeIncreaseExecuted',
    type: 'event',
    signature:
      '0x63436e10a2625186e471ce7bf020ce763b4f6f3caa2d7e33e73981aa1bf4c6b6',
  },
  {
    anonymous: false,
    inputs: [
      ...partialPrefix,
      ...selfContainedPartialContext,
      ...partialDeltas,
      {
        components: v92DecreaseValues,
        indexed: false,
        internalType: 'struct IUpdatePositionSize.DecreasePositionSizeValues',
        name: 'values',
        type: 'tuple',
      },
    ],
    name: 'PositionSizeDecreaseExecuted',
    type: 'event',
    signature:
      '0xe74b50af866d7f8e3577bc959bf73a2690841f0abce22ab0cfb1b1c84122a7d7',
  },
  {
    anonymous: false,
    inputs: [
      ...partialPrefix,
      ...selfContainedPartialContext,
      ...partialDeltas,
      {
        components: v9LegacyIncreaseValues,
        indexed: false,
        internalType: 'struct IUpdatePositionSize.IncreasePositionSizeValues',
        name: 'values',
        type: 'tuple',
      },
    ],
    name: 'PositionSizeIncreaseExecuted',
    type: 'event',
    signature:
      '0xf09a9c949c4bd4cbe75b424bea11c683c3ae55e7cdb8321c3ec37e01af72c8d5',
  },
] as const;
