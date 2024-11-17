import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Address, AbiEvent, decodeEventLog } from 'viem';

import { addresses } from 'src/utils/addresses';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

import { ChainsService } from 'src/global/chains.service';
import { BotsService } from '../bots/bots.service';
import { eventParsers, eventToActionParser } from 'src/actions/eventParsers';
import { RegisteredEventType } from 'src/types';
import { ContractsService } from './contracts.service';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

@Injectable()
export class ContractMonitorService implements OnModuleDestroy {
  private lastBlockNumberByChainId: Record<number, bigint>;
  status: 'initialize' | 'ready';

  readonly registeredEventNames: string[] = [];

  constructor(
    private readonly logger: Logger,
    private chainsService: ChainsService,
    private botsService: BotsService,
    private contractsService: ContractsService,
  ) {
    this.status = 'initialize';

    this.lastBlockNumberByChainId = {};

    this.loadLastBlockNumberByChainId();

    this.registeredEventNames = eventParsers.map((item) => item.eventName);
  }

  onModuleDestroy() {}

  async loadLastBlockNumberByChainId() {
    const promises = this.chainsService.availableChains.map(async (chain) => {
      const publicClient = this.chainsService.publicClient(chain.id);

      const blockNumber = await publicClient.getBlockNumber();

      this.lastBlockNumberByChainId[chain.id] = blockNumber;
    });

    await Promise.all(promises);

    this.status = 'ready';
  }

  async checkContract(id: number) {
    try {
      const contract = await this.contractsService.findOne(id);

      const currentBlockNumber = await this.chainsService
        .publicClient(contract.chainId)
        .getBlockNumber();

      for (
        let i = this.lastBlockNumberByChainId[contract.chainId] + 1n;
        i <= currentBlockNumber;
        i += 1n
      ) {
        this.logger.log(
          `Start CheckContract: contract:${id} chain:${contract.chainId} address:${contract.address} block:${Number(i)}`,
        );

        const eventLogs = await this.getLogs(i, contract.chainId);

        if (eventLogs.length > 0) {
          await this.botsService.handleActionItems(
            contract,
            Number(i),
            eventLogs.map((item) =>
              eventToActionParser(item as RegisteredEventType),
            ),
          );
        }

        this.lastBlockNumberByChainId[421614] = currentBlockNumber;

        this.logger.log(
          `End CheckContract: contract:${id} chain:${contract.chainId} address:${contract.address} block:${Number(i)}`,
        );
      }
    } catch (err) {
      this.logger.log(`Failed CheckContract: ${id}`, err);
    }
  }

  async getLogs(blockNumber: bigint, chainId: number) {
    return (
      await this.chainsService.publicClient(chainId).getLogs<AbiEvent>({
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        fromBlock: blockNumber,
        toBlock: blockNumber,
      })
    )
      .filter(
        (log) =>
          log.topics.length > 0 &&
          this.registeredEventNames.includes(
            expectedEventSignatures[log.topics[0] as string],
          ),
      )
      .map((log) =>
        decodeEventLog({
          abi: gnsMultiCollatDiamondAbi,
          data: log.data,
          topics: log.topics,
        }),
      );
  }
}
