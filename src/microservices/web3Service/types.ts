import { Address } from 'viem';

export type Erc20TransferPayload = {
  mnemonic: string;
  accountIndex: number;
  chainId: number;
  erc20ContractAddress: Address;
  toAddress: Address;
  amount: bigint;
};

export type Erc20BalancePayload = {
  chainId: number;
  erc20ContractAddress: Address;
  address: Address;
};

export type Erc20AllowancePayload = {
  chainId: number;
  erc20ContractAddress: Address;
  address: Address;
  spender: Address;
};

export type Erc20ApprovePayload = {
  mnemonic: string;
  accountIndex: number;
  chainId: number;
  erc20ContractAddress: Address;
  spender: Address;
  amount: bigint;
};

export type NativeTransferPayload = {
  mnemonic: string;
  accountIndex: number;
  chainId: number;
  toAddress: Address;
  amount: bigint;
};

export type NativeBalancePayload = {
  chainId: number;
  address: Address;
};

export type WaitForTransactionReceiptPayload = {
  chainId: number;
  hash: `0x${string}`;
  confirmations: number;
};

export type EstimateGasPayload = {
  chainId: number;
  accountAddress: Address;
  toAddress: Address;
  amount: bigint;
};

export type GetBlockPayload = {
  chainId: number;
  blockNumber: bigint;
};

export type GetLogsPayload = {
  chainId: number;
  address: Address;
  fromBlock: bigint;
  toBlock: bigint;
};
