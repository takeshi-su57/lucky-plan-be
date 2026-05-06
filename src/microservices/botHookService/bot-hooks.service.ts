import { Injectable } from '@nestjs/common';
import { Contract, BotStatus, Platform } from 'generated/prisma/client';
import {
  Address,
  decodeEventLog,
  Log,
  parseAbiItem,
  WatchEventReturnType,
} from 'viem';

import 'dotenv';

import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

import { getWeb3Info } from 'src/web3/utils';

import { PrismaService } from 'src/global/prisma.service';

import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';

import { getAdditionalParams } from '../apiService/modules/strategy/strategy-library';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';
import { abiItem as marketExecutedEventAbi } from 'src/web3/platform/gns/v10/eventParsers/market-executed.parser';
import { abiItem as limitExecutedEventAbi } from 'src/web3/platform/gns/v10/eventParsers/limit-executed.parser';
import { BotsService } from '../apiService/modules/bots/bots.service';
import { ChainPriority } from 'src/types';

@Injectable()
export class BotHooksService {
  private unwatches: Record<number, WatchEventReturnType[]>;

  constructor(
    private readonly evmChainsService: EvmChainsService,
    private readonly prismaService: PrismaService,
    private readonly botsService: BotsService,
    private readonly logger: LogsService,
  ) {
    this.unwatches = {};
  }

  destroyUnwatch() {
    Object.values(this.unwatches)
      .flat()
      .forEach((unwatch) => {
        unwatch();
      });

    this.unwatches = {};
  }

  async setupHookHandlers() {
    try {
      const allBots = await this.prismaService.bot.findMany({
        where: {
          status: {
            notIn: [BotStatus.Stop, BotStatus.Dead],
          },
        },
        include: {
          follower: true,
          strategy: true,
          leaderContract: true,
          followerContract: true,
          plan: true,
          missions: true,
        },
      });

      const existsFlag: Record<number, boolean> = {};

      for (const bot of allBots) {
        const additionalParams = getAdditionalParams(bot.strategy);

        if (additionalParams.mode !== 'hook') {
          continue;
        }

        existsFlag[bot.id] = true;

        if (this.unwatches[bot.id] && this.unwatches[bot.id].length > 0) {
          continue;
        }

        // does not support gmx yet
        if (bot.leaderContract.platform === Platform.GMX) {
          continue;
        }

        if (bot.leaderContract.platform === Platform.AVNT) {
          const unwatch1 = this.evmChainsService
            .paidPublicWSClient(bot.leaderContract.chainId)
            .watchEvent({
              address: avntContractAddresses.VaultManager as `0x${string}`,
              event: parseAbiItem(
                'event USDCReceivedFromTrader(address indexed trader, uint256 amount)',
              ),
              args: {
                trader: bot.leaderAddress.toLowerCase() as `0x${string}`,
              },
              onLogs: (logs) => this.handleAvntLogs(bot.leaderContract, logs),
            });

          const unwatch2 = this.evmChainsService
            .paidPublicWSClient(bot.leaderContract.chainId)
            .watchEvent({
              address: avntContractAddresses.VaultManager as `0x${string}`,
              event: parseAbiItem(
                'event USDCSentToTrader(address indexed trader, uint256 amount)',
              ),
              args: {
                trader: bot.leaderAddress.toLowerCase() as `0x${string}`,
              },
              onLogs: (logs) => this.handleAvntLogs(bot.leaderContract, logs),
            });

          this.unwatches[bot.id] = [unwatch1, unwatch2];
        }

        if (bot.followerContract.platform === Platform.GNS) {
          const unwatch1 = this.evmChainsService
            .paidPublicWSClient(bot.followerContract.chainId)
            .watchEvent({
              address: bot.followerContract.address as Address,
              event: marketExecutedEventAbi,
              args: {
                user: bot.followerAddress.toLowerCase() as `0x${string}`,
              },
              onLogs: (logs) => this.handleLogs(bot.followerContract, logs),
            });

          const unwatch2 = this.evmChainsService
            .paidPublicWSClient(bot.followerContract.chainId)
            .watchEvent({
              address: bot.followerContract.address as Address,
              event: limitExecutedEventAbi,
              args: {
                user: bot.followerAddress.toLowerCase() as `0x${string}`,
              },
              onLogs: (logs) => this.handleLogs(bot.followerContract, logs),
            });

          this.unwatches[bot.id] = [unwatch1, unwatch2];
        }

        this.logger.log({
          severity: 'Emergency',
          summary: 'bot-hook>setupHookHandlers',
          details: `setup hook handler for bot ${bot.id}`,
        });
      }

      // remove unwatches that are not in the existsFlag
      Object.keys(existsFlag).forEach((botId) => {
        if (!existsFlag[Number(botId)]) {
          this.unwatches[Number(botId)].forEach((unwatch) => {
            unwatch();
          });

          delete this.unwatches[Number(botId)];
        }
      });
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'BotHooksService>setupHookHandlers',
        details: getReadableError(err),
      });
    }
  }

  private async handleAvntLogs(contract: Contract, logs: Log[]) {
    const perpLogs = await Promise.allSettled(
      logs
        .filter((log) => log.transactionHash !== null)
        .map(async (log) => {
          return this.evmChainsService.readWithSemaphore(
            contract.chainId,
            ChainPriority.HIGH,
            async (publicClient) => {
              const transaction = await publicClient.getTransactionReceipt({
                hash: log.transactionHash!,
              });

              if (!transaction) {
                return [];
              }

              return transaction.logs.filter(
                (item) =>
                  item.address.toLowerCase() === contract.address.toLowerCase(),
              );
            },
          );
        }),
    );

    await this.handleLogs(
      contract,
      perpLogs
        .filter((item) => item.status === 'fulfilled')
        .flatMap((item) => item.value || []),
    );
  }

  private async handleLogs(contract: Contract, logs: Log[]) {
    const info = getWeb3Info(contract.platform, contract.version);

    const actionItems = logs
      .filter((log) =>
        info.eventSignatures
          ? info.eventSignatures[log.topics[0] as string]
          : true,
      )
      .map((log) => {
        try {
          const decoded: any = decodeEventLog({
            abi: info.abi,
            data: log.data,
            topics: log.topics,
          });

          let eventLog = decoded;

          if (contract.platform === Platform.GMX) {
            eventLog = parseEvent(
              decoded.args.eventName,
              decoded.args.eventData,
            );
          }

          return {
            eventLog,
            blockNumber: Number(log.blockNumber),
            logIndex: Number(log.logIndex),
          };
        } catch {
          return null;
        }
      })
      .filter((item) => !!item)
      .sort((a, b) => {
        if (a.blockNumber === b.blockNumber) {
          return a.logIndex - b.logIndex;
        } else {
          return a.blockNumber - b.blockNumber;
        }
      })
      .filter((log) =>
        getWeb3Info(
          contract.platform,
          contract.version,
        ).tradeEventNames.includes(log.eventLog.eventName),
      )
      .map((log) => ({
        item: getWeb3Info(
          contract.platform,
          contract.version,
        ).eventToActionParser(log.eventLog as any),
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      }));

    if (actionItems.length > 0) {
      await this.botsService.handleActionItems(contract, actionItems, true);
    }
  }
}
