import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { validateMnemonic } from '@scure/bip39';
import { Address, english, mnemonicToAccount } from 'viem/accounts';
import { erc20Abi } from 'viem';
import { PubSub } from 'graphql-subscriptions';
import * as dayjs from 'dayjs';

import { PUB_SUB } from 'src/global/global.module';
import { PrismaService } from 'src/global/prisma.service';
import { UsersService } from 'src/users/users.service';
import { ContractsService } from 'src/contracts/contracts.service';
import { getReadableError } from 'src/utils';

import { ChainsService } from 'src/global/chains.service';
import { Contract } from 'src/contracts/entities/contract.entity';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { SUBSCRIPTION_TOKEN, USDCCollateralIndex } from 'src/utils/constants';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { Mission } from 'src/missions/entities/mission.entity';
import {
  ContractExecutionResult,
  FollowerDetail,
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

@Injectable()
export class FollowerService {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
    private usersService: UsersService,
    private contractService: ContractsService,
    private chainsService: ChainsService,
    private tradingVariableService: TradingVariableService,
    private tradeService: TradeService,
    private pnlSnapshotsService: PnlSnapshotsService,
    private logger: Logger,
  ) {}

  async moveAsset({
    address,
    contract,
    amount,
    kind,
  }: {
    address: string;
    contract: Contract;
    amount: bigint;
    kind: 'usdcDeposit' | 'usdcWithdraw' | 'ethDeposit' | 'ethWithdraw';
  }) {
    try {
      const masterFollower = await this.prismaService.follower.findUnique({
        where: {
          accountIndex: 1,
        },
      });

      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      if (!follower || !masterFollower) {
        throw new Error('Wrong address');
      }

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const followerWallet = this.chainsService.walletClient(
        contract.chainId,
        follower,
      );

      const masterWallet = this.chainsService.walletClient(
        contract.chainId,
        masterFollower,
      );

      let tx: string;

      switch (kind) {
        case 'usdcWithdraw': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000n} USDC from ${follower.address} to ${masterFollower.address}`,
          );

          const { request } = await publicClient.simulateContract({
            account: followerWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [masterFollower.address as Address, amount],
          });

          tx = await followerWallet.writeContract(request);

          break;
        }
        case 'usdcDeposit': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000n} USDC from ${masterFollower.address} to ${follower.address}`,
          );

          const { request } = await publicClient.simulateContract({
            account: masterWallet.account,
            address: collateralInfo.collateral,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [follower.address as Address, amount],
          });

          tx = await masterWallet.writeContract(request);

          break;
        }
        case 'ethWithdraw': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000000n} gwei from ${follower.address} to ${masterFollower.address}`,
          );

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

          break;
        }
        case 'ethDeposit': {
          this.logger.log(
            `FollowerService>moveAsset>: Move ${amount / 1000000000n} gwei from ${masterFollower.address} to ${follower.address}`,
          );

          tx = await masterWallet.sendTransaction({
            account: masterWallet.account!,
            to: follower.address as Address,
            value: amount,
            chain: masterWallet.chain,
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
      this.logger.error(`FollowerService>moveAsset>: ${getReadableError(err)}`);
    }

    return false;
  }

  async withdrawAllUSDC(address: string, contractId: number): Promise<boolean> {
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

      await this.moveAsset({
        address,
        contract: contract,
        amount: usdcBalance,
        kind: 'usdcWithdraw',
      });

      return true;
    } catch (err) {
      this.logger.error(
        `FollowerService>withdrawAllUSDC>: ${getReadableError(err)}`,
      );
    }

    return false;
  }

  async withdrawAllETH(address: string, contractId: number): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const ethBalance = await publicClient.getBalance({
        address: address as Address,
      });

      await this.moveAsset({
        address,
        contract: contract,
        amount: ethBalance,
        kind: 'ethWithdraw',
      });

      return true;
    } catch (err) {
      this.logger.error(
        `FollowerService>withdrawAll>: ${getReadableError(err)}`,
      );
    }

    return false;
  }

  async getPrivateKey(address: string) {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonic = mnemonicMetadata?.value || '';

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    const record = await this.prismaService.follower.findUnique({
      where: { address },
    });

    if (!record) {
      throw new Error('Wrong address');
    }

    const account = mnemonicToAccount(mnemonic, {
      accountIndex: record.accountIndex,
    });

    return `0x${Array.from(account.getHdKey().privateKey!)
      .map((byte) => byte.toString(16).padStart(2, '0')) // Convert each byte to hex
      .join('')}`;
  }

  async generateNewFollower() {
    const mnemonicMetadata = await this.prismaService.metadata.findUnique({
      where: {
        key: this.prismaService.metadataKeys.mnemonic.key,
      },
    });

    const mnemonic = mnemonicMetadata?.value || '';

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
        const user = await this.usersService.getUserByAddress(
          account.address.toLowerCase(),
        );

        if (!user) {
          await this.usersService.addFollower(account.address.toLowerCase());
        }

        return await this.prismaService.follower.create({
          data: {
            address: account.address.toLowerCase(),
            publicKey: account.publicKey,
            accountIndex,
          },
        });
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async followerAssetBalanceUpdateCron() {
    try {
      const contracts = await this.contractService.findAll();

      for (const contract of contracts) {
        const updatedFollowers = await this.loadFollowers(contract.id);

        this.pubSub.publish(SUBSCRIPTION_TOKEN.followerDetailsUpdated, {
          [SUBSCRIPTION_TOKEN.followerDetailsUpdated]: updatedFollowers,
        });
      }
    } catch (err) {
      this.logger.error(
        `FollowerService>followerAssetBalanceUpdateCron>: ${getReadableError(err)}`,
      );
    }
  }

  async getPendingOrders(
    address: string,
    contractId: number,
  ): Promise<FollowerPendingOrder[]> {
    try {
      const contract = await this.contractService.findOne(contractId);

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
      console.log(err);
    }

    return [];
  }

  async getTrades(
    address: string,
    contractId: number,
  ): Promise<FollowerTrade[]> {
    try {
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
      console.log(err);
    }

    return [];
  }

  async closeTradeMarket(
    input: CloseTradeInput,
  ): Promise<ContractExecutionResult> {
    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address,
        },
      });

      if (!follower) {
        throw new Error('Follower not found');
      }

      const walletClient = this.chainsService.walletClient(
        contract.chainId,
        follower,
      );
      const publicClient = this.chainsService.publicClient(contract.chainId);

      const currentPrice = await this.tradingVariableService.getPairPrice(
        input.pairIndex,
      );

      const tx = await this.tradeService.closeTradeMarket(
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
          return {
            success: false,
            message: JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        }
      }

      return {
        success: false,
        message: 'Transaction not found',
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    } catch (err) {
      return {
        success: false,
        message: JSON.stringify(err, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    }
  }

  async cancelOrderAfterTimeout(
    input: CancelOrderAfterTimeoutInput,
  ): Promise<ContractExecutionResult> {
    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address,
        },
      });

      if (!follower) {
        throw new Error('Follower not found');
      }

      const walletClient = this.chainsService.walletClient(
        contract.chainId,
        follower,
      );
      const publicClient = this.chainsService.publicClient(contract.chainId);

      const tx = await this.tradeService.cancelOrderAfterTimeout(
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
            message: `Order canceled`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        } else {
          return {
            success: false,
            message: JSON.stringify(transaction.logs, (_, v) =>
              typeof v === 'bigint' ? v.toString() : v,
            ),
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        }
      }

      return {
        success: false,
        message: 'Transaction not found',
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    } catch (err) {
      return {
        success: false,
        message: JSON.stringify(err, (_, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
        address: input.address,
        index: input.index,
        contractId: input.contractId,
      };
    }
  }

  async loadFollowers(contractId: number): Promise<FollowerDetail[]> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const publicClient = this.chainsService.publicClient(contract.chainId);

      const collateralInfo = this.tradingVariableService.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const followerEntities = await this.prismaService.follower.findMany();

      const ethMap: Record<string, bigint> = {};
      const usdcMap: Record<string, bigint> = {};
      const pnlSnapshotsMap: Record<string, PnlSnapshot[]> = {};

      const usdcPromises = followerEntities.map(async (entity) => {
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
      });

      await Promise.allSettled(usdcPromises);

      return followerEntities.map((entity) => ({
        ...entity,
        contractId,
        ethBalance: ethMap[entity.address]?.toString() || null,
        usdcBalance: usdcMap[entity.address]?.toString() || null,
        pnlSnapshots: pnlSnapshotsMap[entity.address] || [],
      }));
    } catch (err) {
      this.logger.error(
        `FollowerService>loadFollowers>: ${getReadableError(err)}`,
      );
    }

    return [];
  }

  findAllDetails(contractId: number) {
    return this.loadFollowers(contractId);
  }

  findAll() {
    return this.prismaService.follower.findMany();
  }
}
