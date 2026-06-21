import { Injectable } from '@nestjs/common';

import {
  ActionRouter,
  CopyTradingModule,
  ContractMonitor,
  CopyTradingTaskExecutor,
} from './copy-trading.components';

@Injectable()
export class CopyTradingFlowService extends CopyTradingModule {
  constructor(
    private readonly contractMonitor: ContractMonitor,
    private readonly actionRouter: ActionRouter,
    private readonly taskExecutor: CopyTradingTaskExecutor,
  ) {
    super();
  }

  async runOnchainEventListenerCron(): Promise<void> {
    const batches = await this.contractMonitor.scanAllContracts();
    const failedContractIds = new Set<number>();

    await this.actionRouter.loadContext();

    for (const batch of batches) {
      if (failedContractIds.has(batch.contract.id)) {
        continue;
      }

      try {
        if (batch.actionItems.length > 0) {
          await this.actionRouter.routeFollowerActionItems(
            batch.contract,
            batch.blockNumber,
            batch.actionItems,
          );

          await this.actionRouter.routeLeaderActionItems(
            batch.contract,
            batch.blockNumber,
            batch.actionItems,
          );
        }

        await this.contractMonitor.markContractBatchScanned(batch);
      } catch {
        // Do not advance later blocks for this contract after a failed block.
        failedContractIds.add(batch.contract.id);
      }
    }
  }

  async runTaskExecutorCron(): Promise<void> {
    await this.taskExecutor.executeAvailableTasks();
    await this.taskExecutor.reconcileFailedTasks();
    await this.taskExecutor.reconcileAwaitTasks();
  }

  async run(): Promise<void> {
    await this.runOnchainEventListenerCron();
    await this.runTaskExecutorCron();
  }
}
