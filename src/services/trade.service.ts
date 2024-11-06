import { Injectable } from '@nestjs/common';

import { Address, WalletClient, zeroAddress } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

import { ChainsService } from 'src/contracts/chains.service';
import { addresses } from 'src/utils/addresses';
import { Trade } from '../types';

@Injectable()
export class TradeService {
  constructor(private chainsService: ChainsService) {}

  async openTrade(
    wallet: WalletClient,
    chainId: number,
    args: {
      trade: Trade;
      maxSlippageP: number;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
        account: wallet.account,
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'openTrade',
        args: [args.trade, args.maxSlippageP, zeroAddress],
      });

    return wallet.writeContract(request);
  }

  async updateMaxClosingSlippageP(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      maxSlippageP: number;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
        account: wallet.account,
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'updateMaxClosingSlippageP',
        args: [args.index, args.maxSlippageP],
      });

    return wallet.writeContract(request);
  }

  async closeTradeMarket(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      expectedPrice: bigint;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
        account: wallet.account,
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'closeTradeMarket',
        args: [args.index, args.expectedPrice],
      });

    return wallet.writeContract(request);
  }

  async updateTp(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      newTp: bigint;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
        account: wallet.account,
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'updateTp',
        args: [args.index, args.newTp],
      });

    return wallet.writeContract(request);
  }

  async updateSl(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      newSl: bigint;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
        account: wallet.account,
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'updateSl',
        args: [args.index, args.newSl],
      });

    return wallet.writeContract(request);
  }

  async updateLeverage(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      newLeverage: number;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
        account: wallet.account,
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'updateLeverage',
        args: [args.index, args.newLeverage],
      });

    return wallet.writeContract(request);
  }

  async increasePositionSize(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      collateralDelta: bigint;
      leverageDelta: number;
      expectedPrice: bigint;
      maxSlippageP: number;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
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

    return wallet.writeContract(request);
  }

  async decreasePositionSize(
    wallet: WalletClient,
    chainId: number,
    args: {
      index: number;
      collateralDelta: bigint;
      leverageDelta: number;
      expectedPrice: bigint;
    },
  ) {
    const { request } = await this.chainsService
      .publicClient(chainId)
      .simulateContract({
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

    return wallet.writeContract(request);
  }
}
