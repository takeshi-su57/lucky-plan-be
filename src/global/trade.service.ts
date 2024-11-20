import { Injectable } from '@nestjs/common';

import { Address, PublicClient, WalletClient, zeroAddress } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

import { addresses } from 'src/utils/addresses';
import { Trade } from '../types';

@Injectable()
export class TradeService {
  async openTrade(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      trade: Trade;
      maxSlippageP: number;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'openTrade',
      args: [args.trade, args.maxSlippageP, zeroAddress],
    });

    return await wallet.writeContract(request);
  }

  async updateMaxClosingSlippageP(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      maxSlippageP: number;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'updateMaxClosingSlippageP',
      args: [args.index, args.maxSlippageP],
    });

    return await wallet.writeContract(request);
  }

  async closeTradeMarket(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      expectedPrice: bigint;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'closeTradeMarket',
      args: [args.index, args.expectedPrice],
    });

    return await wallet.writeContract(request);
  }

  async updateTp(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      newTp: bigint;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'updateTp',
      args: [args.index, args.newTp],
    });

    return await wallet.writeContract(request);
  }

  async updateSl(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      newSl: bigint;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'updateSl',
      args: [args.index, args.newSl],
    });

    return await wallet.writeContract(request);
  }

  async updateLeverage(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      newLeverage: number;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'updateLeverage',
      args: [args.index, args.newLeverage],
    });

    return await wallet.writeContract(request);
  }

  async increasePositionSize(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      collateralDelta: bigint;
      leverageDelta: number;
      expectedPrice: bigint;
      maxSlippageP: number;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'increasePositionSize',
      args: [
        args.index,
        args.collateralDelta,
        args.leverageDelta,
        args.expectedPrice,
        args.maxSlippageP,
      ],
    });

    return await wallet.writeContract(request);
  }

  async decreasePositionSize(
    wallet: WalletClient,
    publicClient: PublicClient,
    chainId: number,
    args: {
      index: number;
      collateralDelta: bigint;
      leverageDelta: number;
      expectedPrice: bigint;
    },
  ) {
    const { request } = await publicClient.simulateContract({
      account: wallet.account,
      address: addresses[chainId.toString() as keyof typeof addresses].global
        .gnsMultiCollatDiamond as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'decreasePositionSize',
      args: [
        args.index,
        args.collateralDelta,
        args.leverageDelta,
        args.expectedPrice,
      ],
    });

    return await wallet.writeContract(request);
  }
}
