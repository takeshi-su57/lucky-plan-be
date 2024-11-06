import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Address, AbiEvent, decodeEventLog } from 'viem';

import * as fs from 'fs';
import * as path from 'path';

import { addresses } from 'src/utils/addresses';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

import { TradeService } from './trade.service';
import { ChainsService } from 'src/contracts/chains.service';

const expectedEventSignatures: Record<string, string> = Object.fromEntries(
  gnsMultiCollatDiamondAbi
    .filter((item) => item.type === 'event')
    .map((item) => [item.signature, item.name]),
);

export type ContractEventLog = {
  eventName: string;
  args?: unknown[];
};

@Injectable()
export class ContractMonitorService implements OnModuleDestroy {
  private lastBlockNumberByChainId: Record<number, bigint>;
  status: 'ready' | 'not ready';

  readonly registeredEventNames: string[];
  readonly taskEventNames: string[];
  readonly trackEventNames: string[];

  constructor(
    private chainsService: ChainsService,
    private tradeService: TradeService,
  ) {
    this.status = 'not ready';

    this.lastBlockNumberByChainId = {};

    this.loadLastBlockNumberByChainId();

    this.taskEventNames = [
      'MarketExecuted',
      'LimitExecuted',
      'TradeCollateralUpdated',
      'TradeSlUpdated',
      'TradeTpUpdated',
      'TradeMaxClosingSlippagePUpdated',
      'LeverageUpdateExecuted',
      'PositionSizeDecreaseExecuted',
      'PositionSizeIncreaseExecuted',
    ];
    this.trackEventNames = [
      'MarketOrderInitiated',
      'LeverageUpdateInitiated',
      'PositionSizeUpdateInitiated',
      'MarketCloseCanceled',
      'MarketOpenCanceled',
    ];

    this.registeredEventNames = [
      ...this.taskEventNames,
      ...this.trackEventNames,
    ];

    console.log(expectedEventSignatures);
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

  async checkContractByChains() {
    const currentBlockNumber = await this.chainsService
      .publicClient(421614)
      .getBlockNumber();
    console.log('current block', currentBlockNumber);
    console.log('Scan block: ', this.lastBlockNumberByChainId[421614]);
    console.log(
      'check blocks: ',
      currentBlockNumber - this.lastBlockNumberByChainId[421614],
    );

    const blockNumbers: bigint[] = [];

    for (
      let i = this.lastBlockNumberByChainId[421614] + 1n;
      i <= currentBlockNumber;
      i += 1n
    ) {
      blockNumbers.push(i);
    }

    const promises = blockNumbers.map((bn) => {
      return this.getLogs(bn, 421614);
    });

    const results = await Promise.all(promises);

    const filteredResults = results.filter((item) => item.length > 0);

    if (filteredResults.length > 0) {
      console.log(filteredResults);

      const filePath = path.join(
        __dirname,
        '..',
        '..',
        '..',
        'files',
        `record_${Number(blockNumbers[0])}_${Number(blockNumbers[blockNumbers.length - 1])}.txt`,
      );

      try {
        fs.writeFileSync(
          filePath,
          filteredResults
            .map((item, index) => [
              blockNumbers[index],
              item
                .map(
                  (item) =>
                    `${item.eventName} ==> ${JSON.stringify((item.args as any)?.orderId)}`,
                )
                .join('\n'),
            ])
            .map((item) => `BlockNumber: ${item[0]} \n\n${item[1]}`)
            .join('\n\n'),
          'utf8',
        );
        console.log('Data successfully written to file');
      } catch (err) {
        console.error('Error writing to file:', err);
      }
    }

    this.lastBlockNumberByChainId[421614] = currentBlockNumber;
  }

  async getRawLogs(blockNumber: bigint, chainId: number) {
    const rawLogs = await this.chainsService
      .publicClient(chainId)
      .getLogs<AbiEvent>({
        address: addresses[chainId.toString() as keyof typeof addresses].global
          .gnsMultiCollatDiamond as Address,
        fromBlock: blockNumber,
        toBlock: blockNumber,
      });

    const logs = rawLogs
      // filter expected logs
      .filter(
        (log) =>
          log.topics.length > 0 &&
          this.registeredEventNames.includes(
            expectedEventSignatures[log.topics[0] as string],
          ),
      )
      .map((log) => {
        return decodeEventLog({
          abi: gnsMultiCollatDiamondAbi,
          data: log.data,
          topics: log.topics,
        });
      });

    return logs;
  }
}
