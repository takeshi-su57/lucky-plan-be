import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog } from 'viem';
import { Contract } from '@prisma/client';

import { gnsMultiCollatDiamondAbi } from 'src/microservices/web3Service/platform/gns/v10/abi/GNSMultiCollatDiamond';
import {
  eventParsers,
  eventToActionParser,
} from 'src/microservices/web3Service/platform/gns/v10/eventParsers';
import { getReadableError } from '../../utils';
import { ChainPriority, ServiceStatus } from 'src/types';

import { ContractsService } from '../apiService/modules/contracts/contracts.service';
import { TradeHistoriesService } from '../apiService/modules/trade-histories/trade-histories.service';
import { LogsService } from '../../global/logs.service';
import { Web3Service } from '../../global/web3.service';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

@Injectable()
export class ContractMonitorService {
  status: ServiceStatus;

  readonly registeredEventNames: string[] = [];
  static BATCH_SIZE = 4000n;

  constructor(
    private web3Service: Web3Service,
    private contractsService: ContractsService,
    private tradeHistoriesService: TradeHistoriesService,
    private readonly logger: LogsService,
  ) {
    this.registeredEventNames = eventParsers.map((item) => item.eventName);
    this.status = ServiceStatus.READY;
  }

  async checkContractsForLeaderboard() {
    this.status = ServiceStatus.PROCESS;

    const contracts = await this.contractsService.findAll();

    for (const contract of contracts) {
      // temporarily skip testnet contracts
      // if (contract.isTestnet) {
      //   continue;
      // }

      await this.checkContractForLeaderboard(contract);
    }

    this.status = ServiceStatus.READY;
  }

  async checkContractForLeaderboard(contract: Contract) {
    try {
      const currentBlockNumber = await this.web3Service.getBlockNumber(
        contract.chainId,
      );

      let fromBlock = BigInt(contract.lastLeaderboardBlockNumber) + 1n;

      while (fromBlock <= currentBlockNumber) {
        const toBlock =
          fromBlock + ContractMonitorService.BATCH_SIZE < currentBlockNumber
            ? fromBlock + ContractMonitorService.BATCH_SIZE
            : currentBlockNumber;

        const actionItems = await this.getLogs(fromBlock, toBlock, contract);

        const block = await this.web3Service.getBlock({
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
          blockNumber: fromBlock,
        });

        if (actionItems.length > 0) {
          await this.tradeHistoriesService.handleActionItems(
            contract.id,
            actionItems.map((item) => ({
              ...item,
              timestamp: new Date(Number(block.timestamp) * 1000),
            })),
          );
        }

        await this.contractsService.updateLastLeaderboardBlockNumber(
          contract.id,
          Number(toBlock),
        );

        await this.logger.log({
          severity: 'Info',
          summary: 'leaderboard>contract-monitor>checkContractForLeaderboard',
          details: `chain:${contract.chainId} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        });

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'leaderboard>contract-monitor>checkContractForLeaderboard',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });
    }
  }

  async getLogs(fromBlock: bigint, toBlock: bigint, contract: Contract) {
    return (
      await this.web3Service.getLogs({
        chainId: contract.chainId,
        priority: ChainPriority.HIGH,
        address: contract.address as Address,
        fromBlock,
        toBlock,
      })
    )
      .filter(
        (log) =>
          log.topics.length > 0 &&
          this.registeredEventNames.includes(
            expectedEventSignatures[log.topics[0] as string],
          ),
      )
      .map((log) => {
        try {
          const parsed = eventToActionParser(
            contract.id,
            decodeEventLog({
              abi: gnsMultiCollatDiamondAbi,
              data: log.data,
              topics: log.topics,
            }),
          );

          return {
            item: parsed,
            blockNumber: Number(log.blockNumber),
          };
        } catch (err) {
          this.logger.nativeLog({
            severity: 'Error',
            summary: 'leaderboard>contract-monitor.service>parseEventLog',
            details: getReadableError(err),
          });
        }

        return null;
      })
      .filter((item) => !!item);
  }
}
