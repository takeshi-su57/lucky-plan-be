import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Address, AbiEvent, decodeEventLog } from 'viem';

import { addresses } from 'src/utils/addresses';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

import { ClientService } from './client.service';
import { TradeService } from './trade.service';

const expectedEventSignatures: Record<string, boolean> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, true]),
);

export type ContractEventLog = {
  eventName: string;
  args?: unknown[];
};

@Injectable()
export class ContractMonitorService implements OnModuleDestroy {
  private unwachtesByChainId: Record<number, () => void>;
  private errByChainId: Record<number, Error>;
  private lastBlockNumberByChainId: Record<number, bigint>;

  constructor(
    private clientService: ClientService,
    private tradeService: TradeService,
  ) {
    this.unwachtesByChainId = {};
    this.errByChainId = {};
    this.lastBlockNumberByChainId = {};

    this.loadLastBlockNumberByChainId();
  }

  onModuleDestroy() {}

  async loadLastBlockNumberByChainId() {
    for (const chain of this.clientService.availableChains) {
      const publicClient = this.clientService.publicClients[chain.id];

      const blockNumber = await publicClient.getBlockNumber();

      this.lastBlockNumberByChainId[chain.id] = blockNumber;
    }
  }

  checkContractByChains() {
    console.log('Started Contract Scan');

    this.clientService.availableChains.map((chain) => {
      this.handleBlock(this.lastBlockNumberByChainId[chain.id], chain.id);
    });
  }

  async handleBlock(blockNumber: bigint, chainId: number) {
    try {
      const rawLogs = await this.clientService
        .publicClient(chainId)
        .getLogs<AbiEvent>({
          address: addresses[chainId.toString() as keyof typeof addresses]
            .global.gnsMultiCollatDiamond as Address,
          fromBlock: blockNumber,
          toBlock: blockNumber,
        });

      const logs = rawLogs
        .map((log) => {
          try {
            if (
              log.topics.length > 0 &&
              expectedEventSignatures[log.topics[0] as string]
            ) {
              return decodeEventLog({
                abi: gnsMultiCollatDiamondAbi,
                data: log.data,
                topics: log.topics,
              });
            } else {
              return null;
            }
          } catch (err) {
            console.log('Error at decoding event log', err, log);
            return null;
          }
        })
        .filter((eventLog) => !!eventLog);

      this.tradeService.handleLogs(
        chainId,
        logs as unknown as ContractEventLog[],
      );

      this.lastBlockNumberByChainId[chainId]++;
    } catch (err) {
      console.log('Error at handling block', err, { blockNumber, chainId });
    }
  }
}
