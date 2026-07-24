const legacyTradeComponents = [
  { internalType: 'address', name: 'trader', type: 'address' },
  { internalType: 'uint256', name: 'pairIndex', type: 'uint256' },
  { internalType: 'uint256', name: 'index', type: 'uint256' },
  { internalType: 'uint256', name: 'initialPosToken', type: 'uint256' },
  { internalType: 'uint256', name: 'positionSizeDai', type: 'uint256' },
  { internalType: 'uint256', name: 'openPrice', type: 'uint256' },
  { internalType: 'bool', name: 'buy', type: 'bool' },
  { internalType: 'uint256', name: 'leverage', type: 'uint256' },
  { internalType: 'uint256', name: 'tp', type: 'uint256' },
  { internalType: 'uint256', name: 'sl', type: 'uint256' },
] as const;

const legacyMarketInputs = [
  {
    indexed: true,
    internalType: 'uint256',
    name: 'orderId',
    type: 'uint256',
  },
  {
    components: legacyTradeComponents,
    indexed: false,
    internalType: 'struct StorageInterfaceV5.Trade',
    name: 't',
    type: 'tuple',
  },
  { indexed: false, internalType: 'bool', name: 'open', type: 'bool' },
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
    internalType: 'uint256',
    name: 'positionSizeDai',
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
    name: 'daiSentToTrader',
    type: 'uint256',
  },
] as const;

const legacyLimitInputs = [
  {
    indexed: true,
    internalType: 'uint256',
    name: 'orderId',
    type: 'uint256',
  },
  {
    indexed: false,
    internalType: 'uint256',
    name: 'limitIndex',
    type: 'uint256',
  },
  {
    components: legacyTradeComponents,
    indexed: false,
    internalType: 'struct StorageInterfaceV5.Trade',
    name: 't',
    type: 'tuple',
  },
  {
    indexed: true,
    internalType: 'address',
    name: 'nftHolder',
    type: 'address',
  },
  {
    indexed: false,
    internalType: 'enum StorageInterfaceV5.LimitOrder',
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
    internalType: 'uint256',
    name: 'positionSizeDai',
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
    name: 'daiSentToTrader',
    type: 'uint256',
  },
] as const;

/**
 * Minimal execution ABI spanning the legacy callback stack used before the
 * merged diamond. The callback contracts were upgraded in place, so the ABI
 * intentionally contains all execution-event overloads emitted by V6/V7.
 */
export const gnsLegacyTradingCallbacksAbi = [
  {
    anonymous: false,
    inputs: legacyMarketInputs,
    name: 'MarketExecuted',
    type: 'event',
    signature:
      '0x2739a12dffae5d66bd9e126a286078ed771840f2288f0afa5709ce38c3330997',
  },
  {
    anonymous: false,
    inputs: [
      ...legacyMarketInputs,
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
      '0xca42b0e44cd853d207b87e8f8914eaefef9c9463a8c77ca33754aa62f6904f00',
  },
  {
    anonymous: false,
    inputs: legacyLimitInputs,
    name: 'LimitExecuted',
    type: 'event',
    signature:
      '0x165b0f8d6347f7ebe92729625b03ace41aeea8fd7ebf640f89f2593ab0db63d1',
  },
  {
    anonymous: false,
    inputs: [
      ...legacyLimitInputs,
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
      '0x1ab0771256522e5114b583b488c490436d6f8fe02b1e1c9697443e8704c4e840',
  },
  {
    anonymous: false,
    inputs: [
      ...legacyLimitInputs,
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
      '0xa97091b8c54bf9d1906c2a06322d0ea74fedde4538cdcdf95d81d0ffdca41857',
  },
] as const;
