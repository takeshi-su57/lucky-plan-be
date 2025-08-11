import { Address, ReadContractReturnType } from 'viem';
import { Trade } from 'src/types';
import { gnsMultiCollatDiamondAbi } from './abi/GNSMultiCollatDiamond';

export type OpenTradePayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    trade: Trade;
    maxSlippageP: number;
  };
};

export type UpdateMaxClosingSlippagePPayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    maxSlippageP: number;
  };
};

export type CloseTradeMarketPayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    expectedPrice: bigint;
  };
};

export type CancelOrderAfterTimeoutPayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
  };
};

export type UpdateTpPayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    newTp: bigint;
  };
};

export type UpdateSlPayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    newSl: bigint;
  };
};

export type UpdateLeveragePayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    newLeverage: number;
  };
};

export type IncreasePositionSizePayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    collateralDelta: bigint;
    leverageDelta: number;
    expectedPrice: bigint;
    maxSlippageP: number;
  };
};

export type DecreasePositionSizePayload = {
  mnemonic: string;
  accountIndex: number;
  contractId: number;
  args: {
    index: number;
    collateralDelta: bigint;
    leverageDelta: number;
    expectedPrice: bigint;
  };
};

export type GetPendingOrdersPayload = {
  contractId: number;
  args: {
    address: Address;
  };
};

export type GetPendingOrdersReturnType = ReadContractReturnType<
  typeof gnsMultiCollatDiamondAbi,
  'getPendingOrders'
>;

export type GetTradesPayload = {
  contractId: number;
  args: {
    address: Address;
  };
};

export type GetTradesReturnType = ReadContractReturnType<
  typeof gnsMultiCollatDiamondAbi,
  'getTrades'
>;

export type GetTradePayload = {
  contractId: number;
  args: {
    address: Address;
    index: number;
  };
};

export type GetTradeReturnType = ReadContractReturnType<
  typeof gnsMultiCollatDiamondAbi,
  'getTrade'
>;

export type GetCollateralPricePayload = {
  contractId: number;
  args: {
    collateralIndex: number;
  };
};

export type GetCollateralPriceReturnType = ReadContractReturnType<
  typeof gnsMultiCollatDiamondAbi,
  'getCollateralPriceUsd'
>;
