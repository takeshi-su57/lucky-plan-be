import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog } from 'viem';
import { Contract } from '@prisma/client';

import { gnsMultiCollatDiamondAbi } from 'src/microservices/web3Service/platform/gns/v10/abi/GNSMultiCollatDiamond';
import {
  eventParsers,
  eventToActionParser,
} from 'src/microservices/web3Service/platform/gns/v10/eventParsers';

import { BotsService } from '../apiService/modules/bots/bots.service';
import { ContractsService } from '../apiService/modules/contracts/contracts.service';
import { getReadableError } from '../../utils';
import { LogsService } from '../../global/logs.service';
import { ServiceStatus } from 'src/types';
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
    private botsService: BotsService,
    private contractsService: ContractsService,
    private readonly logger: LogsService,
  ) {
    this.registeredEventNames = eventParsers.map((item) => item.eventName);
    this.status = ServiceStatus.READY;
  }

  async checkContractsForBots() {
    this.status = ServiceStatus.PROCESS;

    const contracts = await this.contractsService.findAll();

    for (const contract of contracts) {
      // temporarily skip testnet contracts
      if (contract.isTestnet) {
        continue;
      }

      await this.checkContractForBots(contract);
    }

    this.status = ServiceStatus.READY;
  }

  async checkContractForBots(contract: Contract) {
    try {
      const currentBlockNumber = await this.web3Service.getBlockNumber(
        contract.chainId,
      );

      let fromBlock = BigInt(contract.lastBlockNumber) + 1n;

      while (fromBlock <= currentBlockNumber) {
        const toBlock =
          fromBlock + ContractMonitorService.BATCH_SIZE < currentBlockNumber
            ? fromBlock + ContractMonitorService.BATCH_SIZE
            : currentBlockNumber;

        const actionItems = await this.getLogs(fromBlock, toBlock, contract);

        if (actionItems.length > 0) {
          await this.botsService.handleActionItems(contract, actionItems);
        }

        await this.contractsService.updateLastBlockNumber(
          contract.id,
          Number(toBlock),
        );

        await this.logger.log({
          severity: 'Info',
          summary: 'contract-monitor>checkContractForBots',
          details: `chain:${contract.chainId} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        });

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'contract-monitor>checkContractForBots',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });
    }
  }

  async getLogs(fromBlock: bigint, toBlock: bigint, contract: Contract) {
    return (
      await this.web3Service.getLogs({
        chainId: contract.chainId,
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
            summary: 'contract-monitor.service>parseEventLog',
            details: getReadableError(err),
          });
        }

        return null;
      })
      .filter((item) => !!item);
  }
}
