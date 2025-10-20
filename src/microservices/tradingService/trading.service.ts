import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog } from 'viem';
import { Contract, ContractStatus, Platform } from '@prisma/client';

import { BotsService } from '../apiService/modules/bots/bots.service';
import { ContractsService } from '../apiService/modules/contracts/contracts.service';
import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';
import { ChainPriority, ServiceStatus } from 'src/types';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';

import { getWeb3Info } from 'src/web3/utils';
import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';

import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';
import {
  avntMarginUpdatedAbi,
  avntMarketExecutedAbi,
  avntLimitExecutedAbi,
} from 'src/web3/platform/avnt/v1/abi/AvntGeneral';

@Injectable()
export class TradingService {
  isReceivedKillProcess = false;
  status: ServiceStatus;

  static BATCH_SIZE = 4000n;

  constructor(
    private evmAdapterService: EvmAdapterService,
    private botsService: BotsService,
    private contractsService: ContractsService,
    private readonly logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;
    this.isReceivedKillProcess = false;
  }

  async checkContractsForBots() {
    this.status = ServiceStatus.PROCESS;

    const contracts = await this.contractsService.findAll();

    const promises = contracts
      .filter((contract) => contract.status === ContractStatus.Live)
      .map((contract) => this.checkContractForBots(contract));

    await Promise.allSettled(promises);

    this.status = ServiceStatus.READY;
  }

  async checkContractForBots(contract: Contract) {
    try {
      const currentBlockNumber = await this.evmAdapterService.getBlockNumber({
        chainId: contract.chainId,
        priority: ChainPriority.HIGH,
      });

      let fromBlock = BigInt(contract.lastBlockNumber) + 1n;

      while (fromBlock <= currentBlockNumber) {
        if (this.isReceivedKillProcess) {
          break;
        }

        const toBlock =
          fromBlock + TradingService.BATCH_SIZE < currentBlockNumber
            ? fromBlock + TradingService.BATCH_SIZE
            : currentBlockNumber;

        const logs = (
          await this.evmAdapterService.getLogs({
            chainId: contract.chainId,
            priority: ChainPriority.HIGH,
            events:
              contract.platform === Platform.AVNT
                ? ([avntMarketExecutedAbi, avntLimitExecutedAbi] as const)
                : undefined,
            address: contract.address as Address,
            fromBlock,
            toBlock,
          })
        ).filter((log) => log.topics.length > 0);

        if (contract.platform === Platform.AVNT) {
          const additionalLogs = (
            await this.evmAdapterService.getLogs({
              chainId: contract.chainId,
              priority: ChainPriority.HIGH,
              address: avntContractAddresses.Trading as `0x${string}`,
              events: [avntMarginUpdatedAbi] as const,
              fromBlock,
              toBlock,
            })
          ).filter((log) => log.topics.length > 0);

          logs.push(...additionalLogs);
        }

        const actionItems = logs
          .filter((log) => {
            const info = getWeb3Info(contract.platform, contract.version);

            return info.eventSignatures
              ? info.eventSignatures[log.topics[0] as string]
              : true;
          })
          .map((log) => {
            const decoded: any = decodeEventLog({
              abi: getWeb3Info(contract.platform, contract.version).abi,
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
          })
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
          await this.botsService.handleActionItems(contract, actionItems);
        }

        await this.contractsService.updateLastBlockNumber(
          contract.id,
          Number(toBlock),
        );

        await this.logger.log({
          severity: 'Info',
          summary: 'trading>contract-monitor>checkContractForBots',
          details: `chain:${contract.chainId} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        });

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'trading>contract-monitor>checkContractForBots',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });
    }
  }
}
