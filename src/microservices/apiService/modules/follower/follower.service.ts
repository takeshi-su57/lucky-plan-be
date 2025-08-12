import { Injectable } from '@nestjs/common';
import { validateMnemonic } from '@scure/bip39';
import { Address, english, mnemonicToAccount } from 'viem/accounts';
import { isAddress } from 'viem';
import * as dayjs from 'dayjs';
import { BotStatus, MissionStatus } from '@prisma/client';

import { Contract } from 'src/microservices/apiService/modules/contracts/entities/contract.entity';
import { USDCCollateralIndex } from 'src/utils/constants';
import { MissionForwardDetails } from 'src/microservices/apiService/modules/missions/entities/mission.entity';
import {
  ContractExecutionResult,
  FollowerConnection,
  FollowerEdge,
  FollowerPendingOrder,
  FollowerTrade,
} from './entities/follower.entity';
import { PnlSnapshot } from 'src/microservices/apiService/modules/trade-histories/entities/trade-history.entity';
import {
  CancelOrderAfterTimeoutInput,
  CloseTradeInput,
  UpdateSlInput,
  UpdateTpInput,
  WithdrawPositivePnlInput,
} from './dto/follower.input';
import { getReadableError } from 'src/utils';
import { EncryptedData } from 'src/types';

import { PrismaService } from 'src/global/prisma.service';
import { PnlSnapshotsService } from 'src/microservices/apiService/modules/trade-histories/pnlsnapshot.service';
import { LogsService } from 'src/global/logs.service';
import { SecurityService } from 'src/global/security.service';
import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { Web3Service } from 'src/global/web3.service';
import { GnsV10Service } from 'src/global/gnsV10.service';

@Injectable()
export class FollowerService {
  constructor(
    private prismaService: PrismaService,
    private contractService: ContractsService,
    private web3Service: Web3Service,
    private gnsV10Service: GnsV10Service,
    private pnlSnapshotsService: PnlSnapshotsService,
    private logger: LogsService,
    private securityService: SecurityService,
  ) {}

  async getMnemonic(mnemonicStr: string): Promise<string> {
    const isSafeApp = await this.securityService.isSafeApp();

    const mnemonic = isSafeApp
      ? await this.securityService.decrypt(
          JSON.parse(mnemonicStr) as EncryptedData,
        )
      : mnemonicStr;

    if (!validateMnemonic(mnemonic, english)) {
      throw new Error('Wrong mnemonic, plz check seed the db metadata');
    }

    return mnemonic;
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

      if (!follower || !masterFollower || follower.userId !== userId) {
        throw new Error('Wrong address');
      }

      // skip recursive transaction
      if (
        follower.address.toLowerCase() === masterFollower.address.toLowerCase()
      ) {
        return true;
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      const collateralInfo = this.gnsV10Service.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      switch (kind) {
        case 'usdc': {
          tx = await this.web3Service.erc20Transfer({
            chainId: contract.chainId,
            mnemonic,
            accountIndex: masterFollower.accountIndex,
            erc20ContractAddress: collateralInfo.collateral,
            toAddress: follower.address as Address,
            amount,
          });

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>depositAsset',
            details: `Move ${amount / 1000000n} USDC from ${masterFollower.address} to ${follower.address} tx: ${tx}`,
          });

          break;
        }
        case 'eth': {
          tx = await this.web3Service.nativeTransfer({
            chainId: contract.chainId,
            mnemonic,
            accountIndex: masterFollower.accountIndex,
            toAddress: follower.address as Address,
            amount,
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
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
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

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

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

      const collateralInfo = this.gnsV10Service.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      switch (kind) {
        case 'usdc': {
          tx = await this.web3Service.erc20Transfer({
            chainId: contract.chainId,
            mnemonic,
            accountIndex: follower.accountIndex,
            erc20ContractAddress: collateralInfo.collateral,
            toAddress: masterFollower.address as Address,
            amount,
          });

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>withdrawAsset',
            details: `Move ${amount / 1000000n} USDC from ${follower.address} to ${masterFollower.address} tx: ${tx}`,
          });

          break;
        }
        case 'eth': {
          const gas = await this.web3Service.estimateGas({
            chainId: contract.chainId,
            accountAddress: follower.address as Address,
            toAddress: masterFollower.address as Address,
            amount,
          });

          const { maxFeePerGas } = await this.web3Service.estimateFeesPerGas(
            contract.chainId,
          );

          tx = await this.web3Service.nativeTransfer({
            chainId: contract.chainId,
            mnemonic,
            accountIndex: follower.accountIndex,
            toAddress: masterFollower.address as Address,
            amount: amount - gas * maxFeePerGas,
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
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
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

      const collateralInfo = this.gnsV10Service.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      const usdcBalance = await this.web3Service.erc20Balance({
        chainId: contract.chainId,
        erc20ContractAddress: collateralInfo.collateral,
        address: address as Address,
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

      const ethBalance = await this.web3Service.nativeBalance({
        chainId: contract.chainId,
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
    password: string,
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
      if (!(await this.securityService.isValidPassword(password))) {
        throw new Error('Password is incorrect');
      }

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

      if (!isAddress(address) || !masterFollower) {
        throw new Error('Wrong address');
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      const collateralInfo = this.gnsV10Service.getCollateral(
        contract.id,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      switch (kind) {
        case 'usdc': {
          tx = await this.web3Service.erc20Transfer({
            chainId: contract.chainId,
            mnemonic,
            accountIndex: masterFollower.accountIndex,
            erc20ContractAddress: collateralInfo.collateral,
            toAddress: address as Address,
            amount,
          });

          await this.logger.log({
            severity: 'Info',
            summary: 'FollowerService>withdrawAssetToAny',
            details: `Move ${amount / 1000000n} USDC from ${masterFollower.address} to ${address} tx: ${tx}`,
          });

          break;
        }
        case 'eth': {
          tx = await this.web3Service.nativeTransfer({
            chainId: contract.chainId,
            mnemonic,
            accountIndex: masterFollower.accountIndex,
            toAddress: address as Address,
            amount,
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
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
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
        summary: `FollowerService>withdrawAssetToAny tx: ${tx}`,
        details: getReadableError(err),
      });
    }

    return false;
  }

  async withdrawUSDCToUser(
    userId: string,
    password: string,
    amount: number,
    contractId: number,
  ): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      const collateralInfo = this.gnsV10Service.getCollateral(
        contractId,
        USDCCollateralIndex[
          contract.chainId as keyof typeof USDCCollateralIndex
        ],
      );

      await this.withdrawAssetToAny(userId, password, {
        address: userId as Address,
        contract: contract,
        amount: BigInt(Math.floor(amount * Number(collateralInfo.precision))),
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
    password: string,
    amount: number,
    contractId: number,
  ): Promise<boolean> {
    try {
      const contract = await this.contractService.findOne(contractId);

      await this.withdrawAssetToAny(userId, password, {
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

    const mnemonic = await this.getMnemonic(user.mnemonic || '');

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
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address,
        },
      });

      if (!follower) {
        throw new Error('Follower not found');
      }

      const pendingOrders = await this.gnsV10Service.getPendingOrders({
        contractId,
        args: {
          address: address as Address,
        },
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

      const trades = await this.gnsV10Service.getTrades({
        contractId,
        args: {
          address: address as Address,
        },
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
          status: {
            notIn: [MissionStatus.Closed, MissionStatus.Ignored],
          },
        },
        orderBy: { id: 'desc' },
        include: {
          targetPosition: true,
          achievePosition: true,
          tasks: {
            include: {
              action: true,
              followerActions: {
                include: {
                  action: true,
                },
              },
            },
          },
        },
      });

      const missionMaps = new Map<string, MissionForwardDetails>();

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
          address: input.address.toLowerCase(),
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

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      const currentPrice = await this.gnsV10Service.getPairPrice(
        input.pairIndex,
      );

      tx = await this.gnsV10Service.closeTradeMarket({
        mnemonic,
        accountIndex: follower.accountIndex,
        contractId: input.contractId,
        args: {
          index: input.index,
          expectedPrice: currentPrice,
        },
      });

      if (tx) {
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
          hash: tx as `0x${string}`,
          confirmations: 1,
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

  async updateSl(
    userId: string,
    input: UpdateSlInput,
  ): Promise<ContractExecutionResult> {
    let tx: string = 'no tx';

    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address.toLowerCase(),
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

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      tx = await this.gnsV10Service.updateSl({
        mnemonic,
        accountIndex: follower.accountIndex,
        contractId: input.contractId,
        args: {
          index: input.index,
          newSl: BigInt(input.newSl),
        },
      });

      if (tx) {
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
          hash: tx as `0x${string}`,
          confirmations: 1,
        });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Trade sl updated`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: `FollowerService>updateSl tx: ${tx}`,
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
        summary: `FollowerService>updateSl tx: ${tx}`,
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

  async updateTp(
    userId: string,
    input: UpdateTpInput,
  ): Promise<ContractExecutionResult> {
    let tx: string = 'no tx';

    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address.toLowerCase(),
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

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      tx = await this.gnsV10Service.updateTp({
        mnemonic,
        accountIndex: follower.accountIndex,
        contractId: input.contractId,
        args: {
          index: input.index,
          newTp: BigInt(input.newTp),
        },
      });

      if (tx) {
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
          hash: tx as `0x${string}`,
          confirmations: 1,
        });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Trade tp updated`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: `FollowerService>updateTp tx: ${tx}`,
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
        summary: `FollowerService>updateTp tx: ${tx}`,
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

  async withdrawPositivePnl(
    userId: string,
    input: WithdrawPositivePnlInput,
  ): Promise<ContractExecutionResult> {
    let tx: string = 'no tx';

    try {
      const contract = await this.contractService.findOne(input.contractId);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: input.address.toLowerCase(),
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

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      tx = await this.gnsV10Service.withdrawPositivePnl({
        mnemonic,
        accountIndex: follower.accountIndex,
        contractId: input.contractId,
        args: {
          index: input.index,
          amountCollateral: BigInt(input.amountCollateral),
        },
      });

      if (tx) {
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
          hash: tx as `0x${string}`,
          confirmations: 1,
        });

        if (transaction.status === 'success') {
          return {
            success: true,
            message: `Trade positive pnl withdrawn`,
            address: input.address,
            index: input.index,
            contractId: input.contractId,
          };
        } else {
          await this.logger.log({
            severity: 'Error',
            summary: `FollowerService>withdrawPositivePnl tx: ${tx}`,
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
        summary: `FollowerService>withdrawPositivePnl tx: ${tx}`,
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
          address: input.address.toLowerCase(),
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

      if (!follower) {
        throw new Error('Follower not found');
      }

      if (follower.userId !== userId) {
        throw new Error('Unauthorized User');
      }

      const mnemonic = await this.getMnemonic(user.mnemonic || '');

      tx = await this.gnsV10Service.cancelOrderAfterTimeout({
        mnemonic,
        accountIndex: follower.accountIndex,
        contractId: input.contractId,
        args: {
          index: input.index,
        },
      });

      if (tx) {
        const transaction = await this.web3Service.waitForTransactionReceipt({
          chainId: contract.chainId,
          hash: tx as `0x${string}`,
          confirmations: 1,
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

    const collateralInfo = this.gnsV10Service.getCollateral(
      contractId,
      USDCCollateralIndex[contract.chainId as keyof typeof USDCCollateralIndex],
    );

    const followerEntities = await this.prismaService.follower.findMany({
      where: {
        userId,
        accountIndex: {
          gt: after || 0,
        },
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
        const usdcBalance =
          entity.accountIndex === 1
            ? await this.web3Service.erc20Balance({
                chainId: contract.chainId,
                erc20ContractAddress: collateralInfo.collateral,
                address: entity.address as Address,
              })
            : 0n;

        usdcMap[entity.address] = usdcBalance;

        const ethBalance =
          entity.accountIndex === 1
            ? await this.web3Service.nativeBalance({
                chainId: contract.chainId,
                address: entity.address as Address,
              })
            : 0n;

        ethMap[entity.address] = ethBalance;

        const pnlSnapshots =
          await this.pnlSnapshotsService.getPnlSnapshotsByAddress(
            dayjs(new Date()).format('YYYY-MM-DD'),
            entity.address,
          );

        pnlSnapshotsMap[entity.address] = pnlSnapshots;

        const trades =
          entity.accountIndex === 1
            ? await this.getTrades(entity.address, contractId)
            : [];
        tradesMap[entity.address] = trades;

        const pendingOrders =
          entity.accountIndex === 1
            ? await this.getPendingOrders(entity.address, contractId)
            : [];

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
        hasNextPage: edges.length > 0,
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
