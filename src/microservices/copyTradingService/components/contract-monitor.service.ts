import { Injectable } from '@nestjs/common';
import { Address, decodeEventLog } from 'viem';
import { Contract, ContractStatus, Platform } from 'generated/prisma/client';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { LogsService } from 'src/global/logs.service';
import { ChainPriority } from 'src/types';
import { EvmAdapterService } from 'src/web3/web3/evm-adapter.service';
import { getWeb3Info } from 'src/web3/utils';
import { parseEvent } from 'src/web3/platform/gmx/v2/eventParsers';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';
import { delay, getReadableError } from 'src/utils';

import { ContractMonitor } from '../copy-trading.components';
import { ContractActionBatch, ContractActionItem } from '../copy-trading.types';

@Injectable()
export class ContractMonitorService extends ContractMonitor {
  static BATCH_SIZE = 4000n;
  static DEFAULT_RECHECK_BLOCKS = 100;

  constructor(
    private readonly contractsService: ContractsService,
    private readonly evmAdapterService: EvmAdapterService,
    private readonly logger: LogsService,
  ) {
    super();
  }

  async scanAllContracts(): Promise<ContractActionBatch[]> {
    const contracts = await this.contractsService.findAll();
    const promises = contracts
      .filter((contract) => contract.status === ContractStatus.Live)
      .map((contract) => this.scanContract(contract));

    const results = await Promise.allSettled(promises);

    return results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value);
  }

  async scanContract(contract: Contract): Promise<ContractActionBatch[]> {
    const batches: ContractActionBatch[] = [];

    try {
      const currentBlockNumber = await this.evmAdapterService.getBlockNumber({
        chainId: contract.chainId,
        priority: ChainPriority.HIGH,
      });

      const recheckBlocks = this.getRecheckBlocks();
      const replayStartBlock = Math.max(
        contract.fromBlock,
        contract.lastBlockNumber - recheckBlocks + 1,
      );
      let fromBlock = BigInt(replayStartBlock);

      while (fromBlock <= currentBlockNumber) {
        const toBlock =
          fromBlock + ContractMonitorService.BATCH_SIZE < currentBlockNumber
            ? fromBlock + ContractMonitorService.BATCH_SIZE
            : currentBlockNumber;
        const groupedActionItems = await this.getContractActionItemsByBlock(
          contract,
          fromBlock,
          toBlock,
        );

        batches.push(...groupedActionItems);

        fromBlock = toBlock + 1n;
      }
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: 'copy-trading-system>live-contract-monitor>scanContract',
        details: `chainId:${contract.chainId} ${getReadableError(err)}`,
      });
    }

    return batches;
  }

  async markContractBatchScanned(batch: ContractActionBatch): Promise<void> {
    await this.contractsService.updateLastBlockNumber(
      batch.contract.id,
      batch.blockNumber,
    );

    await this.logger.log({
      severity: 'Info',
      summary: 'copy-trading-system>live-contract-monitor>scanContract',
      details: `chain:${batch.contract.id} block:${batch.blockNumber}`,
    });
  }

  private getRecheckBlocks() {
    const value = Number(process.env.TRADING_RECHECK_BLOCKS);

    return Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : ContractMonitorService.DEFAULT_RECHECK_BLOCKS;
  }

  private async getContractActionItemsByBlock(
    contract: Contract,
    fromBlock: bigint,
    toBlock: bigint,
  ) {
    const logs = (
      await this.evmAdapterService.getLogs({
        chainId: contract.chainId,
        priority: ChainPriority.HIGH,
        address: contract.address as Address,
        fromBlock,
        toBlock,
      })
    ).filter((log) => log.topics.length > 0);

    if (contract.platform === Platform.AVNT) {
      await delay(1_000);
      const additionalLogs = (
        await this.evmAdapterService.getLogs({
          chainId: contract.chainId,
          priority: ChainPriority.HIGH,
          address: avntContractAddresses.Trading as `0x${string}`,
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
        try {
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
            blockHash: log.blockHash ? String(log.blockHash) : null,
            txHash: log.transactionHash ? String(log.transactionHash) : null,
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
        blockHash: log.blockHash,
        txHash: log.txHash,
      }));

    const groupActionItemsByBlock = new Map<number, ContractActionItem[]>();

    actionItems.forEach((item) => {
      const arr = groupActionItemsByBlock.get(item.blockNumber);

      if (arr) {
        arr.push(item);
      } else {
        groupActionItemsByBlock.set(item.blockNumber, [item]);
      }
    });

    return Array.from(groupActionItemsByBlock.entries())
      .sort(([blockNumberA], [blockNumberB]) => blockNumberA - blockNumberB)
      .map(([blockNumber, actionItems]) => ({
        contract,
        blockNumber,
        actionItems,
      }));
  }
}
