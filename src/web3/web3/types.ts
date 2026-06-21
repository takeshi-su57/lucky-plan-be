import { AbiEvent, Address } from 'viem';
import { ChainPriority } from 'src/types';

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
  priority: ChainPriority;
  erc20ContractAddress: Address;
  address: Address;
};

export type Erc20AllowancePayload = {
  chainId: number;
  priority: ChainPriority;
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
  priority: ChainPriority;
  address: Address;
};

export type WaitForTransactionReceiptPayload = {
  chainId: number;
  priority: ChainPriority;
  hash: `0x${string}`;
  confirmations: number;
};

export type EstimateGasPayload = {
  chainId: number;
  priority: ChainPriority;
  accountAddress: Address;
  toAddress: Address;
  amount: bigint;
};

export type GetBlockPayload = {
  chainId: number;
  priority: ChainPriority;
  blockNumber: bigint;
};

export type GetLatestFinalizedBlock = {
  chainId: number;
  priority: ChainPriority;
};

export type GetLogsPayload = {
  chainId: number;
  priority: ChainPriority;
  address: Address;
  events?: readonly AbiEvent[] | readonly unknown[];
  fromBlock: bigint;
  toBlock?: bigint;
};

export type EstimateFeesPerGasPayload = {
  chainId: number;
  priority: ChainPriority;
};

export type GetBlockNumberPayload = {
  chainId: number;
  priority: ChainPriority;
};
