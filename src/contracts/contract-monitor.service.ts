import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Address, AbiEvent, decodeEventLog } from 'viem';

import { addresses } from 'src/utils/addresses';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

import { ChainsService } from 'src/global/chains.service';
import { BotsService } from '../bots/bots.service';
import { eventParsers, eventToActionParser } from 'src/actions/eventParsers';
import { ContractsService } from './contracts.service';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

@Injectable()
export class ContractMonitorService implements OnModuleDestroy {
  status: 'process' | 'ready';

  readonly registeredEventNames: string[] = [];
  static BATCH_SIZE = 1000n;

  constructor(
    private readonly logger: Logger,
    private chainsService: ChainsService,
    private botsService: BotsService,
    private contractsService: ContractsService,
  ) {
    this.registeredEventNames = eventParsers.map((item) => item.eventName);
    this.status = 'ready';
  }

  onModuleDestroy() {}

  async checkContract(id: number) {
    this.status = 'process';

    try {
      const contract = await this.contractsService.findOne(id);

      const currentBlockNumber = await this.chainsService
        .publicClient(contract.chainId)
        .getBlockNumber();

      let fromBlock = BigInt(contract.lastBlockNumber) + 1n;

      while (fromBlock <= currentBlockNumber) {
        const toBlock =
          fromBlock + ContractMonitorService.BATCH_SIZE < currentBlockNumber
            ? fromBlock + ContractMonitorService.BATCH_SIZE
            : currentBlockNumber;

        const actionItems = await this.getLogs(
          fromBlock,
          toBlock,
          contract.chainId,
        );

        this.logger.log(
          `Start CheckContract: contract:${id} chain:${contract.chainId} address:${contract.address} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        );

        if (actionItems.length > 0) {
          console.log(`find contract actions ==> ${actionItems.length}`);

          await this.botsService.handleActionItems(contract, actionItems);

          console.log('finished');
        }

        await this.contractsService.updateLastBlockNumber(id, Number(toBlock));

        this.logger.log(
          `End CheckContract: contract:${id} chain:${contract.chainId} address:${contract.address} block:${Number(fromBlock)} - ${Number(toBlock)}`,
        );

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      this.logger.log(`Failed CheckContract: ${id}`, err);
    }

    this.status = 'ready';
  }

  async getLogs(fromBlock: bigint, toBlock: bigint, chainId: number) {
    return (
      await this.chainsService.publicClient(chainId).getLogs<AbiEvent>({
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
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
      .map((log) => ({
        item: eventToActionParser(
          decodeEventLog({
            abi: gnsMultiCollatDiamondAbi,
            data: log.data,
            topics: log.topics,
          }),
        ),
        blockNumber: Number(log.blockNumber),
      }));
  }
}
