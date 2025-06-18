import { Inject, Injectable } from '@nestjs/common';
import { validateMnemonic } from '@scure/bip39';
import { Address, english, mnemonicToAccount } from 'viem/accounts';
import { erc20Abi, isAddress } from 'viem';
import { PubSub } from 'graphql-subscriptions';
import * as dayjs from 'dayjs';
import { BotStatus } from '@prisma/client';

import { PUB_SUB } from 'src/global/global.module';
import { PrismaService } from 'src/global/prisma.service';

import { ContractsService } from 'src/contracts/contracts.service';
import { getReadableError } from 'src/utils';

import { ChainsService } from 'src/global/chains.service';
import { Contract } from 'src/contracts/entities/contract.entity';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { USDCCollateralIndex } from 'src/utils/constants';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { Mission } from 'src/missions/entities/mission.entity';
import {
  ContractExecutionResult,
  FollowerConnection,
  FollowerEdge,
  FollowerPendingOrder,
  FollowerTrade,
} from './entities/follower.entity';
import { TradeService } from 'src/global/trade.service';
import {
  CancelOrderAfterTimeoutInput,
  CloseTradeInput,
} from './dto/follower.input';
import { PnlSnapshotsService } from 'src/trade-histories/pnlsnapshot.service';
import { PnlSnapshot } from 'src/trade-histories/entities/trade-history.entity';
import { LogsService } from 'src/loggers/logs.service';
import { TaskQueue } from 'src/utils/TaskQueue';
import { EncryptedData, SecurityService } from 'src/global/security.service';

@Injectable()
export class FollowerService {
  private depositAssetQueue: Record<string, TaskQueue>;

  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private contractService: ContractsService,
    private chainsService: ChainsService,
    private tradingVariableService: TradingVariableService,
    private tradeService: TradeService,
    private pnlSnapshotsService: PnlSnapshotsService,
    private logger: LogsService,
    private securityService: SecurityService,
  ) {
    this.depositAssetQueue = {};
  }

  async depositAsset(
    userId: string,
    {
      address,
      contract,
      amount,
      kind,
    }: {
      address: string;
      contract: Contract;
      amount: bigint;
      kind: 'usdc' | 'eth';
    },
  ) {
    if (!this.depositAssetQueue[userId]) {
      this.depositAssetQueue[userId] = new TaskQueue();
    }

    return await this.depositAssetQueue[userId].add(
      async () =>
        await this.depositAssetCore(userId, {
          address,
          contract,
          amount,
          kind,
        }),
    );
  }

  private async depositAssetCore(
    userId: string,
    {
      address,
      contract,
      amount,
      kind,
    }: {
      address: string;
      contract: Contract;
      amount: bigint;
      kind: 'usdc' | 'eth';
    },
  ) {
    let tx: string = 'no tx';

    try {
      const masterFollower = await this.prismaService.follower.findUnique({
        where: {
          userId_accountIndex: {
            userId,
            accountIndex: 1,
          },
        },
      });

      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      const user = await this.prismaService.user.findUnique({
        where: {
          address: userId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const mnemonic = user.mnemonic || '';

      if (!follower || !masterFollower || follower.userId !== userId) {
        throw new Error('Wrong address');
      }

      // skip recursive transaction
      if (
        follower.address.toLowerCase() === masterFollower.address.toLowerCase()
      ) {
        return true;
      }

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const masterWallet = this.chainsService.walletClient(
        mnemonic,
        contract.chainId,
        masterFollower,
      );

      switch (kind) {
        case 'usdc': {
          const { request } = await publicClient.simulateContract({
            account: masterWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [follower.address as Address, amount],
          });

          tx = await masterWallet.writeContract(request);

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>depositAsset',
            details: `Move ${amount / 1000000n} USDC from ${masterFollower.address} to ${follower.address} tx: ${tx}`,
          });

          break;
        }
        case 'eth': {
          tx = await masterWallet.sendTransaction({
            account: masterWallet.account!,
            to: follower.address as Address,
            value: amount,
            chain: masterWallet.chain,
          });

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>depositAsset',
            details: `Move ${amount / 1000000000n} gwei from ${masterFollower.address} to ${follower.address} tx: ${tx}`,
          });

          break;
        }
      }

      if (tx) {
        const transaction = await publicClient.waitForTransactionReceipt({
          hash: tx as `0x${string}`,
          confirmations: 6,
        });

        return transaction.status === 'success';
      } else {
        return false;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>depositAsset tx: ${tx}`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async withdrawAsset(
    userId: string,
    {
      address,
      contract,
      amount,
      kind,
    }: {
      address: string;
      contract: Contract;
      amount: bigint;
      kind: 'usdc' | 'eth';
    },
  ) {
    // skip 0 amount
    if (amount === 0n) {
      return true;
    }

    let tx: string = 'no tx';

    try {
      const masterFollower = await this.prismaService.follower.findUnique({
        where: {
          userId_accountIndex: {
            userId,
            accountIndex: 1,
          },
        },
      });

      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      const user = await this.prismaService.user.findUnique({
        where: {
          address: userId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const mnemonic = user.mnemonic || '';

      if (!follower || !masterFollower) {
        throw new Error('Wrong address');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      // skip recursive transaction
      if (
        follower.address.toLowerCase() === masterFollower.address.toLowerCase()
      ) {
        return true;
      }

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const followerWallet = this.chainsService.walletClient(
        mnemonic,
        contract.chainId,
        follower,
      );

      switch (kind) {
        case 'usdc': {
          const { request } = await publicClient.simulateContract({
            account: followerWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [masterFollower.address as Address, amount],
          });

          tx = await followerWallet.writeContract(request);

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>withdrawAsset',
            details: `Move ${amount / 1000000n} USDC from ${follower.address} to ${masterFollower.address} tx: ${tx}`,
          });

          break;
        }
        case 'eth': {
          const gas = await publicClient.estimateGas({
            account: followerWallet.account?.address,
            to: masterFollower.address as Address,
            value: amount,
          });

          const { maxFeePerGas } = await publicClient.estimateFeesPerGas();

          tx = await followerWallet.sendTransaction({
            account: followerWallet.account!,
            to: masterFollower.address as Address,
            value: amount - gas * maxFeePerGas,
            chain: followerWallet.chain,
          });

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>withdrawAsset',
            details: `Move ${amount / 1000000000n} gwei from ${follower.address} to ${masterFollower.address} tx: ${tx}`,
          });

          break;
        }
      }

      if (tx) {
        const transaction = await publicClient.waitForTransactionReceipt({
          hash: tx as `0x${string}`,
        });

        return transaction.status === 'success';
      } else {
        return false;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>withdrawAsset tx: ${tx}`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async withdrawAllUSDC(
    userId: string,
    address: string,
    contractId: number,
  ): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const usdcBalance = await publicClient.readContract({
        address: collateralInfo.collateral,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as Address],
      });

      // 1000000n (1usdc) is the minimum amount of USDC to withdraw
      if (usdcBalance > 1000000n) {
        await this.withdrawAsset(userId, {
          address,
          contract: contract,
          amount: usdcBalance,
          kind: 'usdc',
        });
      }

      return true;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>withdrawAllUSDC`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async withdrawAllETH(
    userId: string,
    address: string,
    contractId: number,
  ): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const ethBalance = await publicClient.getBalance({
        address: address as Address,
      });

      await this.withdrawAsset(userId, {
        address,
        contract: contract,
        amount: ethBalance,
        kind: 'eth',
      });

      return true;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>withdrawAllETH`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  private async withdrawAssetToAny(
    userId: string,
    {
      address,
      contract,
      amount,
      kind,
    }: {
      address: string;
      contract: Contract;
      amount: bigint;
      kind: 'usdc' | 'eth';
    },
  ) {
    let tx: string = 'no tx';

    try {
      const masterFollower = await this.prismaService.follower.findUnique({
        where: {
          userId_accountIndex: {
            userId,
            accountIndex: 1,
          },
        },
      });

      const user = await this.prismaService.user.findUnique({
        where: {
          address: userId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const mnemonic = user.mnemonic || '';

      if (!isAddress(address) || !masterFollower) {
        throw new Error('Wrong address');
      }

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const masterWallet = this.chainsService.walletClient(
        mnemonic,
        contract.chainId,
        masterFollower,
      );

      switch (kind) {
        case 'usdc': {
          const { request } = await publicClient.simulateContract({
            account: masterWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [address as Address, amount],
          });

          tx = await masterWallet.writeContract(request);

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>withdrawAssetToAny',
            details: `Move ${amount / 1000000n} USDC from ${masterFollower.address} to ${address} tx: ${tx}`,
          });

          break;
        }
        case 'eth': {
          tx = await masterWallet.sendTransaction({
            account: masterWallet.account!,
            to: address as Address,
            value: amount,
            chain: masterWallet.chain,
          });

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>withdrawAssetToAny',
            details: `Move ${amount / 1000000000n} gwei from ${masterFollower.address} to ${address} tx: ${tx}`,
          });

          break;
        }
      }

      if (tx) {
        const transaction = await publicClient.waitForTransactionReceipt({
          hash: tx as `0x${string}`,
        });

        return transaction.status === 'success';
      } else {
        return false;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>withdrawAssetToAny tx: ${tx}`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async withdrawUSDCToUser(
    userId: string,
    amount: number,
    contractId: number,
  ): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const decimals = await publicClient.readContract({
        address: collateralInfo.collateral,
        abi: erc20Abi,
        functionName: 'decimals',
        args: [],
      });

      await this.withdrawAssetToAny(userId, {
        address: userId as Address,
        contract: contract,
        amount: BigInt(Math.floor(amount * Math.pow(10, decimals))),
        kind: 'usdc',
      });

      return true;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>withdrawUSDCToUser`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async withdrawETHToUser(
    userId: string,
    amount: number,
    contractId: number,
  ): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      await this.withdrawAssetToAny(userId, {
        address: userId,
        contract: contract,
        amount: BigInt(Math.floor(amount * Math.pow(10, 18))),
        kind: 'eth',
      });

      return true;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>withdrawETHToUser`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async generateNewFollower(userId: string) {
    const user = await this.prismaService.user.findUnique({
      where: {
        address: userId,
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const mnemonicStr = user.mnemonic || '';

    const mnemonic = this.securityService.isSafeApp
      ? this.securityService.decrypt(JSON.parse(mnemonicStr) as EncryptedData)
      : mnemonicStr;

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    for (let accountIndex = 1; ; accountIndex++) {
      const account = mnemonicToAccount(mnemonic, {
        accountIndex,
      });

      const followerRecord = await this.prismaService.follower.findUnique({
        where: {
          address: account.address.toLowerCase(),
        },
      });

      // find new account
      if (!followerRecord) {
        return await this.prismaService.follower.create({
          data: {
            address: account.address.toLowerCase(),
            publicKey: account.publicKey,
            accountIndex,
            userId,
          },
        });
      }
    }
  }

  private async getPendingOrders(
    address: string,
    contractId: number,
  ): Promise<FollowerPendingOrder[]> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      if (!follower) {
        throw new Error('Follower not found');
      }

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const pendingOrders = await publicClient.readContract({
        address: contract.address as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'getPendingOrders',
        args: [address as Address],
      });

      return pendingOrders.map((order) => ({
        address: order.user.toLowerCase(),
        index: order.index,
        params: JSON.stringify(order, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      }));
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>getPendingOrders`,
        details: getReadableError(err),
      });
    }

    return [];
  }

  private async getTrades(
    address: string,
    contractId: number,
  ): Promise<FollowerTrade[]> {
    try {
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      if (!follower) {
        throw new Error('Follower not found');
      }

      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const trades = await publicClient.readContract({
        address: contract.address as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'getTrades',
        args: [address as Address],
      });

      const tradeIds = trades.map((trade) => ({
        contractId,
        address: trade.user.toLowerCase(),
        index: trade.index,
      }));

      const achievePositions = await this.prismaService.position.findMany({
        where: {
          contractId,
          address: {
            in: tradeIds.map((trade) => trade.address),
          },
          index: {
            in: tradeIds.map((trade) => trade.index),
          },
        },
      });

      const achievePositionIdsMap = new Map<
        number,
        { address: string; index: number }
      >();

      achievePositions.forEach((position) => {
        achievePositionIdsMap.set(position.id, {
          address: position.address,
          index: position.index,
        });
      });

      const missions = await this.prismaService.mission.findMany({
        where: {
          achievePositionId: {
            in: achievePositions.map((position) => position.id),
          },
        },
      });

      const missionMaps = new Map<string, Mission>();

      missions.forEach((mission) => {
        if (!mission.achievePositionId) {
          return;
        }

        const tradeId = achievePositionIdsMap.get(mission.achievePositionId);

        if (!tradeId) {
          return;
        }

        missionMaps.set(`${tradeId.address}-${tradeId.index}`, mission);
      });

      return trades.map((trade) => ({
        address: trade.user.toLowerCase(),
        index: trade.index,
        mission:
          missionMaps.get(`${trade.user.toLowerCase()}-${trade.index}`) || null,
        params: JSON.stringify(trade, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      }));
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>getTrades`,
        details: getReadableError(err),
      });
    }

    return [];
  }

  async closeTradeMarket(
    userId: string,
    input: CloseTradeInput,
  ): Promise<ContractExecutionResult> {
    let tx: string = 'no tx';

    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address,
        },
      });

      const user = await this.prismaService.user.findUnique({
        where: {
          address: userId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const mnemonic = user.mnemonic || '';

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const walletClient = this.chainsService.walletClient(
        mnemonic,
        contract.chainId,
        follower,
      );
      const publicClient = this.chainsService.publicClient(contract.chainId);

      const currentPrice = await this.tradingVariableService.getPairPrice(
        input.pairIndex,
      );

      tx = await this.tradeService.closeTradeMarket(
        walletClient,
        publicClient,
        contract.chainId,
        {
          index: input.index,
          expectedPrice: currentPrice,
        },
      );

      if (tx) {
        const transaction = await publicClient.waitForTransactionReceipt({
          hash: tx as `0x${string}`,
        });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Trade closed`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: `FollowerService>closeTradeMarket tx: ${tx}`,
            details: JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          });

          return {
            success: false,
            message: `${JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            )} tx: ${tx}`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        }
      }

      return {
        success: false,
        message: `Transaction not found tx: ${tx}`,
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>closeTradeMarket tx: ${tx}`,
        details: getReadableError(err),
      });

      return {
        success: false,
        message: `${JSON.stringify(err, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        )} tx: ${tx}`,
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    }
  }

  async cancelOrderAfterTimeout(
    userId: string,
    input: CancelOrderAfterTimeoutInput,
  ): Promise<ContractExecutionResult> {
    let tx: string = 'no tx';

    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address,
        },
      });
      const user = await this.prismaService.user.findUnique({
        where: {
          address: userId,
        },
      });

      if (!user) {
        throw new Error('User not found');
      }

      const mnemonic = user.mnemonic || '';

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const walletClient = this.chainsService.walletClient(
        mnemonic,
        contract.chainId,
        follower,
      );
      const publicClient = this.chainsService.publicClient(contract.chainId);

      tx = await this.tradeService.cancelOrderAfterTimeout(
        walletClient,
        publicClient,
        contract.chainId,
        {
          index: input.index,
        },
      );

      if (tx) {
        const transaction = await publicClient.waitForTransactionReceipt({
          hash: tx as `0x${string}`,
        });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Order canceled tx: ${tx}`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: `FollowerService>cancelOrderAfterTimeout tx: ${tx}`,
            details: JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
          });

          return {
            success: false,
            message: `${JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            )} tx: ${tx}`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        }
      }

      return {
        success: false,
        message: `Transaction not found tx: ${tx}`,
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `FollowerService>cancelOrderAfterTimeout tx: ${tx}`,
        details: getReadableError(err),
      });

      return {
        success: false,
        message: `${JSON.stringify(err, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        )} tx: ${tx}`,
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    }
  }

  async getAvailableFollowers(userId: string, counts: number) {
    const activeBots = await this.prismaService.bot.findMany({
      where: {
        plan: {
          userId,
        },
        status: {
          not: BotStatus.Dead,
        },
      },
    });

    const followerAddressesMap: Record<string, boolean> = {};

    activeBots.forEach((bot) => {
      followerAddressesMap[bot.followerAddress] = true;
    });

    // master account cannot be a follower
    const availableFollowers = await this.prismaService.follower.findMany({
      where: {
        userId: userId.toLowerCase(),
        address: {
          notIn: Object.keys(followerAddressesMap),
        },
        accountIndex: {
          not: 1,
        },
      },
    });

    const validFollowers = [...availableFollowers];

    while (validFollowers.length < counts) {
      const newFollower = await this.generateNewFollower(userId);

      validFollowers.push(newFollower);
    }

    return validFollowers.slice(0, counts);
  }

  async getMasterFollower(userId: string) {
    const masterFollower = await this.prismaService.follower.findUnique({
      where: {
        userId_accountIndex: {
          userId,
          accountIndex: 1,
        },
      },
    });

    if (!masterFollower) {
      return this.generateNewFollower(userId);
    }

    return masterFollower;
  }

  async findAllDetails(
    userId: string,
    contractId: number,
    first: number,
    after: number | null,
  ): Promise<FollowerConnection> {
    const contract = await this.contractService.findOne(contractId);

    const publicClient = this.chainsService.publicClient(contract.chainId);

    const collateralInfo = this.tradingVariableService.getCollateral(
      contractId,
      USDCCollateralIndex[contract.chainId as keyof typeof USDCCollateralIndex],
    );

    const followerEntities = await this.prismaService.follower.findMany({
      where: {
        userId,
        accountIndex: 1,
      },
      take: first,
      orderBy: {
        accountIndex: 'asc',
      },
    });

    const ethMap: Record<string, bigint> = {};
    const usdcMap: Record<string, bigint> = {};
    const pnlSnapshotsMap: Record<string, PnlSnapshot[]> = {};
    const tradesMap: Record<string, FollowerTrade[]> = {};
    const pendingOrdersMap: Record<string, FollowerPendingOrder[]> = {};

    const BATCH_SIZE = 10;

    for (let i = 0; i < followerEntities.length; i += BATCH_SIZE) {
      const batch = followerEntities.slice(i, i + BATCH_SIZE);

      const promises = batch.map(async (entity) => {
        const usdcBalance = await publicClient.readContract({
          address: collateralInfo.collateral,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [entity.address as Address],
        });

        usdcMap[entity.address] = usdcBalance;

        const ethBalance = await publicClient.getBalance({
          address: entity.address as Address,
        });

        ethMap[entity.address] = ethBalance;

        const pnlSnapshots =
          await this.pnlSnapshotsService.getPnlSnapshotsByAddress(
            dayjs(new Date()).format('YYYY-MM-DD'),
            entity.address,
          );

        pnlSnapshotsMap[entity.address] = pnlSnapshots;

        const trades = await this.getTrades(entity.address, contractId);
        tradesMap[entity.address] = trades;

        const pendingOrders = await this.getPendingOrders(
          entity.address,
          contractId,
        );

        pendingOrdersMap[entity.address] = pendingOrders;
      });

      await Promise.allSettled(promises);
    }

    const edges: FollowerEdge[] = followerEntities.map((entity) => ({
      cursor: entity.accountIndex,
      node: {
        ...entity,
        contractId,
        ethBalance: ethMap[entity.address]?.toString() || null,
        usdcBalance: usdcMap[entity.address]?.toString() || null,
        pnlSnapshots: pnlSnapshotsMap[entity.address] || [],
        trades: tradesMap[entity.address] || [],
        pendingOrders: pendingOrdersMap[entity.address] || [],
      },
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: false,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  findAll(userId: string) {
    return this.prismaService.follower.findMany({
      where: {
        userId,
      },
    });
  }
}
