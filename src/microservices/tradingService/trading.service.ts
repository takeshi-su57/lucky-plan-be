import { Injectable } from '@nestjs/common';
import { Contract, ContractStatus } from '@prisma/client';

import { BotsService } from '../apiService/modules/bots/bots.service';
import { PrismaService } from 'src/global/prisma.service';
import { ContractsService } from '../apiService/modules/contracts/contracts.service';
import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';
import { ServiceStatus } from 'src/types';

import { getWeb3Info } from 'src/web3/utils';

@Injectable()
export class TradingService {
  isReceivedKillProcess = false;
  status: ServiceStatus;

  constructor(
    private botsService: BotsService,
    private contractsService: ContractsService,
    private prismaService: PrismaService,
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
      const fromBlock = contract.lastBlockNumber + 1;

      const perpTradingEventLogs =
        await this.prismaService.perpTradingEventLog.findMany({
          where: {
            contractId: contract.id,
            block: {
              gte: fromBlock,
            },
          },
          orderBy: [
            {
              block: 'asc',
            },
            {
              logIndex: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        });

      if (perpTradingEventLogs.length === 0) {
        // await this.logger.log({
        //   severity: 'Info',
        //   summary: 'trading>contract-monitor>checkContractForBots',
        //   details: `chain:${contract.chainId} block:${Number(fromBlock)} - latest, no logs`,
        // });

        return;
      }

      const actionItems = perpTradingEventLogs.map((log) => ({
        item: getWeb3Info(
          contract.platform,
          contract.version,
        ).eventToActionParser(JSON.parse(log.jsonLog) as any),
        blockNumber: log.block,
        logIndex: log.logIndex,
      }));

      if (actionItems.length > 0) {
        await this.botsService.handleActionItems(contract, actionItems);
      }

      const toBlock = Math.max(...perpTradingEventLogs.map((log) => log.block));

      await this.contractsService.updateLastBlockNumber(
        contract.id,
        Number(toBlock),
      );

      await this.logger.log({
        severity: 'Info',
        summary: 'trading>contract-monitor>checkContractForBots',
        details: `chain:${contract.chainId} block:${Number(fromBlock)} - ${Number(toBlock)}`,
      });
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'trading>contract-monitor>checkContractForBots',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });
    }
  }
}
