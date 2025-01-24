import { Injectable, Logger } from '@nestjs/common';
import { Address, AbiEvent, decodeEventLog } from 'viem';
import { Contract } from '@prisma/client';

import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { ChainsService } from 'src/global/chains.service';
import { eventParsers, eventToActionParser } from 'src/actions/eventParsers';

import { BotsService } from './bots/bots.service';
import { ContractsService } from './contracts/contracts.service';
import { TradeHistoriesService } from './trade-histories/trade-histories.service';
import { getReadableError } from './utils';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

@Injectable()
export class ContractMonitorService {
  status: 'process' | 'ready';

  readonly registeredEventNames: string[] = [];
  static BATCH_SIZE = 4000n;

  constructor(
    private chainsService: ChainsService,
    private botsService: BotsService,
    private contractsService: ContractsService,
    private tradeHistoriesService: TradeHistoriesService,
    private readonly logger: Logger,
  ) {
    this.registeredEventNames = eventParsers.map((item) => item.eventName);
    this.status = 'ready';
  }

  async checkContracts() {
    this.status = 'process';

    const contracts = await this.contractsService.findAll();

    const promises = contracts.map(async (contract) => {
      return await this.checkContract(contract);
    });

    await Promise.allSettled(promises);

    this.status = 'ready';
  }

  async checkContract(contract: Contract) {
    try {
      const currentBlockNumber = await this.chainsService
        .publicClient(contract.chainId)
        .getBlockNumber();

      let fromBlock = BigInt(contract.lastBlockNumber) + 1n;

      while (fromBlock <= currentBlockNumber) {
        const toBlock =
          fromBlock + ContractMonitorService.BATCH_SIZE < currentBlockNumber
            ? fromBlock + ContractMonitorService.BATCH_SIZE
            : currentBlockNumber;

        const actionItems = await this.getLogs(fromBlock, toBlock, contract);

        const block = await this.chainsService
          .publicClient(contract.chainId)
          .getBlock({ blockNumber: fromBlock });

        if (actionItems.length > 0) {
          await this.botsService.handleActionItems(contract, actionItems);
          await this.tradeHistoriesService.handleActionItems(
            contract.id,
            new Date(Number(block.timestamp) * 1000),
            actionItems,
          );
        }

        await this.contractsService.updateLastBlockNumber(
          contract.id,
          Number(toBlock),
        );

        this.logger.log(
          `CheckContract: contract:${contract.id} chain:${contract.chainId} address:${contract.address} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        );

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      this.logger.log(
        `src/contract-monitor.service.ts: Failed CheckContract: ${contract.id}`,
        err,
      );
    }
  }

  async getLogs(fromBlock: bigint, toBlock: bigint, contract: Contract) {
    return (
      await this.chainsService
        .publicClient(contract.chainId)
        .getLogs<AbiEvent>({
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
          this.logger.error(
            `contract-monitor.service.ts > parseEventLog ${getReadableError(err)}`,
          );
        }

        return null;
      })
      .filter((item) => !!item);
  }
}
