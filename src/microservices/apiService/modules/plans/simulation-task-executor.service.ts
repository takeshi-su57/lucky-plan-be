import { Injectable } from '@nestjs/common';
import {
  Contract,
  Platform,
  PlanMode,
  TaskStatus,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import {
  Action,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { Strategy } from 'src/microservices/apiService/modules/strategy/entities/strategy.entity';
import {
  clampStrategyLeverage,
  getOpenMissionParams,
  getPositionDecreaseParams,
  getPositionIncreaseParams,
} from 'src/microservices/apiService/modules/strategy/strategy-library';
import { TasksService } from 'src/microservices/apiService/modules/tasks/tasks.service';
import {
  CloseMissionAction,
  MainCollateralIndex,
  MIN_FEE,
  OpenMissionAction,
} from 'src/utils/constants';
import { bigIntSafeJsonParse, eventToAction } from 'src/utils';
import {
  getGnsPositionKey,
  parseGnsPositionKey,
} from 'src/web3/platform/gns/utils';
import { getCollateral } from 'src/web3/platform/gns/v10/configs';
import { leverageUpdateExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/leverage-update-executed.parser';
import { marketExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/market-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-decrease-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/web3/platform/gns/v10/eventParsers/position-size-increase-executed.parser';
import { tradeMaxClosingSlippagePUpdatedEventParser } from 'src/web3/platform/gns/v10/eventParsers/trade-max-closing-slippage-p-updated.parser';
import {
  CancelReason,
  Collateral,
  Trade,
} from 'src/web3/platform/gns/v10/types';

export type SimulationFollowerActionGroup = {
  contract: Contract;
  actionItems: {
    item: ActionItem;
    blockNumber: number;
    logIndex: number;
  }[];
};

export type SimulationTaskExpectation = {
  taskId: number;
  expectedStatus: TaskStatus;
  message: string;
};

export type SimulationExecutionResult = {
  groups: SimulationFollowerActionGroup[];
  expectations: SimulationTaskExpectation[];
};

type SimulationTask = {
  id: number;
  logs: string[];
  action: Action;
  mission: {
    id: number;
    targetPositionKey: string;
    achievePositionKey: string | null;
    bot: {
      followerAddress: string;
      followerContract: Contract;
      leaderContract: Contract;
      leaderCollateralBaseline: number;
      strategy: Strategy;
    };
    tasks: {
      id: number;
      action: Action;
      followerActions: {
        action: Action;
      }[];
    }[];
  };
};

type SimulationTaskExecution = {
  status: TaskStatus;
  message: string;
  actionItem?: SimulationFollowerActionGroup['actionItems'][number];
};

@Injectable()
export class SimulationTaskExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasksService: TasksService,
  ) {}

  async executePlanWindow(planId: number): Promise<SimulationExecutionResult> {
    const tasks = await this.prisma.task.findMany({
      where: {
        status: TaskStatus.Created,
        mission: {
          bot: {
            planId,
            plan: {
              mode: PlanMode.Simulation,
            },
          },
        },
      },
      include: {
        action: true,
        mission: {
          include: {
            bot: {
              include: {
                followerContract: true,
                leaderContract: true,
                follower: true,
                strategy: true,
              },
            },
            tasks: {
              include: {
                action: true,
                followerActions: {
                  include: {
                    action: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ id: 'asc' }],
    });

    const groupedItems = new Map<number, SimulationFollowerActionGroup>();
    const expectations: SimulationTaskExpectation[] = [];
    const taskExecutions: {
      task: SimulationTask;
      execution: SimulationTaskExecution;
    }[] = [];

    const sortedTasks = [...tasks].sort((a, b) => {
      if (a.action.blockNumber !== b.action.blockNumber) {
        return a.action.blockNumber - b.action.blockNumber;
      }

      return a.action.orderInBlock - b.action.orderInBlock;
    });
    const projectedTrades = new Map<number, Trade | null>();

    for (const task of sortedTasks) {
      if (!projectedTrades.has(task.mission.id)) {
        projectedTrades.set(
          task.mission.id,
          this.getProjectedFollowerTrade(task),
        );
      }

      const execution = this.executeVirtualFollowerTask(
        task,
        projectedTrades.get(task.mission.id) || null,
      );

      if (!execution) {
        throw new Error(
          `Unsupported simulation task execution: task ${task.id}, action ${task.action.name}, leader ${task.mission.bot.leaderContract.platform}, follower ${task.mission.bot.followerContract.platform}`,
        );
      }

      taskExecutions.push({ task, execution });
      expectations.push({
        taskId: task.id,
        expectedStatus: execution.actionItem
          ? TaskStatus.Completed
          : execution.status,
        message: execution.message,
      });

      if (execution.actionItem) {
        projectedTrades.set(
          task.mission.id,
          this.applyFollowerActionToTrade(
            projectedTrades.get(task.mission.id) || null,
            execution.actionItem.item,
          ),
        );
      }

      const contract = task.mission.bot.followerContract;
      const existing = groupedItems.get(contract.id);

      if (execution.actionItem) {
        if (existing) {
          existing.actionItems.push(execution.actionItem);
        } else {
          groupedItems.set(contract.id, {
            contract,
            actionItems: [execution.actionItem],
          });
        }
      }
    }

    await this.tasksService.updateMany(
      taskExecutions.map(({ task, execution }) => ({
        id: task.id,
        status: execution.status,
        logs: [
          ...task.logs,
          JSON.stringify({
            timestamp: Date.now(),
            message: execution.message,
          }),
        ],
      })),
    );

    return {
      groups: Array.from(groupedItems.values()),
      expectations,
    };
  }

  private executeVirtualFollowerTask(
    task: SimulationTask,
    projectedTrade: Trade | null,
  ): SimulationTaskExecution | null {
    if (task.mission.bot.followerContract.platform !== Platform.GNS) {
      return null;
    }

    if (this.isOpenTask(task)) {
      return this.createVirtualOpenActionItem(task);
    }

    if (this.isCloseTask(task)) {
      return this.createVirtualCloseActionItem(task, projectedTrade);
    }

    if (
      task.action.name === tradeMaxClosingSlippagePUpdatedEventParser.eventName
    ) {
      return this.createVirtualMaxClosingSlippageActionItem(task);
    }

    if (task.action.name === leverageUpdateExecutedEventParser.eventName) {
      return this.createVirtualLeverageUpdateActionItem(task, projectedTrade);
    }

    if (
      task.action.name === positionSizeIncreaseExecutedEventParser.eventName
    ) {
      return this.createVirtualPositionIncreaseActionItem(task, projectedTrade);
    }

    if (
      task.action.name === positionSizeDecreaseExecutedEventParser.eventName
    ) {
      return this.createVirtualPositionDecreaseActionItem(task, projectedTrade);
    }

    return null;
  }

  private isOpenTask(task: SimulationTask) {
    if (task.action.name === OpenMissionAction) {
      return true;
    }

    if (task.action.name !== marketExecutedEventParser.eventName) {
      return false;
    }

    return marketExecutedEventParser.actionParser(task.action).args.open;
  }

  private isCloseTask(task: SimulationTask) {
    if (task.action.name === CloseMissionAction) {
      return true;
    }

    if (task.action.name !== marketExecutedEventParser.eventName) {
      return false;
    }

    return !marketExecutedEventParser.actionParser(task.action).args.open;
  }

  private createVirtualOpenActionItem(
    task: SimulationTask,
  ): SimulationTaskExecution | null {
    const followerIndex = task.mission.id;
    const followerAddress = task.mission.bot.followerAddress.toLowerCase();
    const followerPositionKey = getGnsPositionKey(
      followerAddress,
      followerIndex,
    );
    const targetPosition = parseGnsPositionKey(task.mission.targetPositionKey);
    const sourceArgs = this.getOpenSourceArgs(task, followerIndex);

    if (!sourceArgs || !targetPosition) {
      return null;
    }

    const args = {
      ...sourceArgs,
      open: true,
      orderId: {
        user: targetPosition.address,
        index: targetPosition.index,
      },
      t: {
        ...sourceArgs.t,
        user: followerAddress,
        index: followerIndex,
      },
      user: followerAddress,
      index: followerIndex,
      amountSentToTrader: 0n,
    };

    return this.createAwaitingExecution(
      task,
      marketExecutedEventParser.eventName,
      followerPositionKey,
      followerAddress,
      args,
      1,
      'Simulation open task projected with strategy sizing',
    );
  }

  private createVirtualCloseActionItem(
    task: SimulationTask,
    projectedTrade: Trade | null,
  ): SimulationTaskExecution | null {
    const trade = projectedTrade;
    const position = this.getFollowerPosition(task);

    if (!trade || !position) {
      return null;
    }

    const followerAddress = task.mission.bot.followerAddress.toLowerCase();
    const closePrice = this.getClosePrice(task);
    const args = {
      ...this.getMarketExecutedSourceArgs(task, trade),
      open: false,
      orderId: {
        user: followerAddress,
        index: position.index,
      },
      t: {
        ...trade,
        user: followerAddress,
        index: position.index,
      },
      user: followerAddress,
      index: position.index,
      oraclePrice: closePrice,
      amountSentToTrader: this.calculateAmountSentToTrader(trade, closePrice),
    };

    return this.createAwaitingExecution(
      task,
      marketExecutedEventParser.eventName,
      task.mission.achievePositionKey!,
      followerAddress,
      args,
      1,
      'Simulation close task projected with virtual PnL',
    );
  }

  private createVirtualMaxClosingSlippageActionItem(
    task: SimulationTask,
  ): SimulationTaskExecution | null {
    const position = this.getFollowerPosition(task);

    if (!position) {
      return null;
    }

    const followerAddress = task.mission.bot.followerAddress.toLowerCase();
    const sourceArgs = tradeMaxClosingSlippagePUpdatedEventParser.actionParser(
      task.action,
    ).args;
    const args = {
      ...sourceArgs,
      user: followerAddress,
      index: position.index,
    };

    return this.createAwaitingExecution(
      task,
      tradeMaxClosingSlippagePUpdatedEventParser.eventName,
      task.mission.achievePositionKey!,
      followerAddress,
      args,
      2,
      'Simulation max closing slippage update projected',
    );
  }

  private createVirtualLeverageUpdateActionItem(
    task: SimulationTask,
    projectedTrade: Trade | null,
  ): SimulationTaskExecution | null {
    const trade = projectedTrade;
    const position = this.getFollowerPosition(task);

    if (!trade || !position) {
      return null;
    }

    const sourceArgs = leverageUpdateExecutedEventParser.actionParser(
      task.action,
    ).args;
    const targetLeverage = clampStrategyLeverage(
      task.mission.bot.strategy,
      Number(sourceArgs.values.newLeverage),
    );
    const currentLeverage = Number(trade.leverage);

    if (targetLeverage === currentLeverage) {
      return this.createStoppedExecution(
        'Simulation leverage update skipped because current leverage already matches target',
      );
    }

    const followerAddress = task.mission.bot.followerAddress.toLowerCase();
    const args = {
      ...sourceArgs,
      orderId: {
        user: followerAddress,
        index: position.index,
      },
      trader: followerAddress,
      index: position.index,
      pairIndex: trade.pairIndex,
      collateralIndex: trade.collateralIndex,
      collateralDelta: 0n,
      isIncrease: targetLeverage > currentLeverage,
      oraclePrice: sourceArgs.oraclePrice || trade.openPrice,
      values: {
        ...sourceArgs.values,
        newCollateralAmount: trade.collateralAmount,
        newLeverage: targetLeverage,
      },
    };

    return this.createAwaitingExecution(
      task,
      leverageUpdateExecutedEventParser.eventName,
      task.mission.achievePositionKey!,
      followerAddress,
      args,
      3,
      'Simulation leverage update projected with strategy clamp',
    );
  }

  private getOpenSourceArgs(task: SimulationTask, followerIndex: number) {
    const followerCollateral = this.getFollowerCollateral(task);

    if (!followerCollateral) {
      return null;
    }

    if (task.action.name === marketExecutedEventParser.eventName) {
      const sourceArgs = marketExecutedEventParser.actionParser(
        task.action,
      ).args;
      const leaderCollateral = this.getLeaderCollateral(task);

      if (!leaderCollateral) {
        return null;
      }

      const openMissionParams = getOpenMissionParams(
        task.mission.bot.strategy,
        {
          leverage: Number(sourceArgs.t.leverage),
          collateralAmount: BigInt(sourceArgs.t.collateralAmount),
          collateralPriceUsd: BigInt(sourceArgs.collateralPriceUsd),
          collateral: leaderCollateral,
          isLong: sourceArgs.t.long,
          openPrice: BigInt(sourceArgs.t.openPrice),
          usdcPrice: 100_000_000n,
          pairIndex: Number(sourceArgs.t.pairIndex),
        },
        task.mission.bot.leaderCollateralBaseline,
      );
      const collateralIndex = this.getFollowerCollateralIndex(task);

      if (collateralIndex === null) {
        return null;
      }

      return {
        ...sourceArgs,
        t: {
          ...sourceArgs.t,
          user: task.mission.bot.followerAddress.toLowerCase(),
          index: followerIndex,
          pairIndex: Number(sourceArgs.t.pairIndex),
          leverage: openMissionParams.leverage,
          long: openMissionParams.long,
          isOpen: true,
          collateralIndex,
          collateralAmount: this.usdcToCollateralAmount(
            openMissionParams.collateralAmount,
            followerCollateral,
          ),
          openPrice: openMissionParams.openPrice,
          tp: openMissionParams.tp,
          sl: openMissionParams.sl,
        },
        collateralPriceUsd: 100_000_000n,
        oraclePrice: BigInt(sourceArgs.oraclePrice || sourceArgs.t.openPrice),
      };
    }

    if (task.action.name !== OpenMissionAction) {
      return null;
    }

    const args = bigIntSafeJsonParse<{
      pairIndex: number;
      collateralAmountUSDC: string;
      leverage: number;
      long: boolean;
      openPrice: string;
      tp: string;
      sl: string;
    }>(task.action.args);
    const collateralIndex = this.getFollowerCollateralIndex(task);

    if (collateralIndex === null) {
      return null;
    }

    return {
      open: true,
      orderId: {
        user: '0x0000000000000000000000000000000000000000',
        index: 0,
      },
      t: {
        user: '0x0000000000000000000000000000000000000000',
        index: 0,
        pairIndex: args.pairIndex,
        leverage: args.leverage,
        long: args.long,
        isOpen: true,
        collateralIndex,
        tradeType: 0,
        collateralAmount: this.usdcToCollateralAmount(
          BigInt(args.collateralAmountUSDC),
          followerCollateral,
        ),
        openPrice: BigInt(args.openPrice),
        tp: BigInt(args.tp),
        sl: BigInt(args.sl),
        __placeholder: 0,
      },
      collateralPriceUsd: 100_000_000n,
      oraclePrice: BigInt(args.openPrice),
      amountSentToTrader: 0n,
    };
  }

  private createVirtualPositionIncreaseActionItem(
    task: SimulationTask,
    projectedTrade: Trade | null,
  ): SimulationTaskExecution | null {
    const trade = projectedTrade;
    const position = this.getFollowerPosition(task);
    const leaderCollateral = this.getLeaderCollateral(task);
    const followerCollateral = this.getFollowerCollateral(task);

    if (!trade || !position || !leaderCollateral || !followerCollateral) {
      return null;
    }

    const sourceArgs = positionSizeIncreaseExecutedEventParser.actionParser(
      task.action,
    ).args;
    const increaseParams = getPositionIncreaseParams(
      task.mission.bot.strategy,
      {
        collateralDelta: BigInt(sourceArgs.collateralDelta),
        leverageDelta: BigInt(sourceArgs.leverageDelta),
        newLeverage: BigInt(sourceArgs.values.newLeverage),
        newOpenPrice: BigInt(sourceArgs.values.newOpenPrice),
      },
      leaderCollateral,
      trade,
    );

    if (increaseParams === null) {
      return this.createStoppedExecution(
        'Simulation position increase skipped because strategy produced no increase',
      );
    }

    if (increaseParams.collateralDelta > 0n) {
      const fee = BigInt(
        Math.max(
          Math.floor(
            (Number(increaseParams.collateralDelta) *
              Number(increaseParams.leverageDelta) *
              0.16) /
              1e5,
          ),
          Number(MIN_FEE),
        ),
      );
      const positionDelta = BigInt(
        Math.floor(
          (Number(increaseParams.collateralDelta) *
            Number(increaseParams.leverageDelta)) /
            1e3,
        ),
      );

      if (positionDelta < fee) {
        return this.createStoppedExecution(
          'Simulation position increase skipped because collateral delta is too small',
        );
      }
    }

    const followerAddress = task.mission.bot.followerAddress.toLowerCase();
    const collateralDelta = this.usdcToCollateralAmount(
      increaseParams.collateralDelta,
      followerCollateral,
    );
    const oldPositionSizeCollateral = this.getPositionSizeCollateral(trade);
    const newCollateralAmount =
      BigInt(trade.collateralAmount) + collateralDelta;
    const newLeverage = Number(trade.leverage) + increaseParams.leverageDelta;
    const newPositionSizeCollateral =
      (newCollateralAmount * BigInt(newLeverage)) / 1_000n;
    const args = {
      ...sourceArgs,
      orderId: {
        user: followerAddress,
        index: position.index,
      },
      cancelReason: CancelReason.NONE,
      trader: followerAddress,
      pairIndex: trade.pairIndex,
      index: position.index,
      long: trade.long,
      oraclePrice: increaseParams.expectedPrice,
      collateralPriceUsd: 100_000_000n,
      collateralIndex: trade.collateralIndex,
      collateralDelta,
      leverageDelta: increaseParams.leverageDelta,
      values: {
        ...sourceArgs.values,
        positionSizeCollateralDelta:
          newPositionSizeCollateral - oldPositionSizeCollateral,
        existingPositionSizeCollateral: oldPositionSizeCollateral,
        newPositionSizeCollateral,
        newCollateralAmount,
        newLeverage,
        newOpenPrice: increaseParams.expectedPrice,
      },
    };

    return this.createAwaitingExecution(
      task,
      positionSizeIncreaseExecutedEventParser.eventName,
      task.mission.achievePositionKey!,
      followerAddress,
      args,
      4,
      'Simulation position increase projected with strategy sizing',
    );
  }

  private createVirtualPositionDecreaseActionItem(
    task: SimulationTask,
    projectedTrade: Trade | null,
  ): SimulationTaskExecution | null {
    const trade = projectedTrade;
    const position = this.getFollowerPosition(task);

    if (!trade || !position) {
      return null;
    }

    const sourceArgs = positionSizeDecreaseExecutedEventParser.actionParser(
      task.action,
    ).args;
    const decreaseParams = getPositionDecreaseParams(
      task.mission.bot.strategy,
      {
        isLeverageUpdate: Number(sourceArgs.collateralDelta) === 0,
        existingPositionSizeCollateral: BigInt(
          sourceArgs.values.existingPositionSizeCollateral,
        ),
        positionSizeCollateralDelta: BigInt(
          sourceArgs.values.positionSizeCollateralDelta,
        ),
        oraclePrice: BigInt(sourceArgs.oraclePrice),
      },
      trade,
    );

    if (
      decreaseParams === null ||
      (decreaseParams.collateralDelta === 0n &&
        decreaseParams.leverageDelta === 0)
    ) {
      return this.createStoppedExecution(
        'Simulation position decrease skipped because strategy produced no decrease',
      );
    }

    const followerAddress = task.mission.bot.followerAddress.toLowerCase();
    const oldPositionSizeCollateral = this.getPositionSizeCollateral(trade);
    const newCollateralAmount =
      BigInt(trade.collateralAmount) - decreaseParams.collateralDelta;
    const newLeverage = Number(trade.leverage) - decreaseParams.leverageDelta;
    const newPositionSizeCollateral =
      (newCollateralAmount * BigInt(newLeverage)) / 1_000n;
    const positionSizeCollateralDelta =
      oldPositionSizeCollateral - newPositionSizeCollateral;
    const args = {
      ...sourceArgs,
      orderId: {
        user: followerAddress,
        index: position.index,
      },
      cancelReason: CancelReason.NONE,
      trader: followerAddress,
      pairIndex: trade.pairIndex,
      index: position.index,
      long: trade.long,
      oraclePrice: decreaseParams.expectedPrice,
      collateralPriceUsd: 100_000_000n,
      collateralIndex: trade.collateralIndex,
      collateralDelta: decreaseParams.collateralDelta,
      leverageDelta: decreaseParams.leverageDelta,
      values: {
        ...sourceArgs.values,
        positionSizeCollateralDelta,
        existingPositionSizeCollateral: oldPositionSizeCollateral,
        newPositionSizeCollateral,
        newCollateralAmount,
        newLeverage,
        partialNetPnlCollateral: this.calculatePartialPnlCollateral(
          trade,
          decreaseParams.expectedPrice,
          oldPositionSizeCollateral,
          positionSizeCollateralDelta,
        ),
      },
    };

    return this.createAwaitingExecution(
      task,
      positionSizeDecreaseExecutedEventParser.eventName,
      task.mission.achievePositionKey!,
      followerAddress,
      args,
      5,
      'Simulation position decrease projected with virtual PnL',
    );
  }

  private getProjectedFollowerTrade(task: SimulationTask): Trade | null {
    const followerActions = task.mission.tasks
      .flatMap((missionTask) =>
        missionTask.followerActions.map((followerAction) => ({
          task: missionTask,
          action: followerAction.action,
        })),
      )
      .filter(({ task: missionTask }) => {
        if (missionTask.action.blockNumber !== task.action.blockNumber) {
          return missionTask.action.blockNumber < task.action.blockNumber;
        }

        return missionTask.action.orderInBlock < task.action.orderInBlock;
      })
      .sort((a, b) => {
        if (a.task.action.blockNumber !== b.task.action.blockNumber) {
          return a.task.action.blockNumber - b.task.action.blockNumber;
        }

        if (a.task.action.orderInBlock !== b.task.action.orderInBlock) {
          return a.task.action.orderInBlock - b.task.action.orderInBlock;
        }

        return a.action.orderInBlock - b.action.orderInBlock;
      });

    let trade: Trade | null = null;

    for (const { action } of followerActions) {
      trade = this.applyFollowerActionToTrade(trade, action);
    }

    return trade;
  }

  private applyFollowerActionToTrade(
    trade: Trade | null,
    action: Action | ActionItem,
  ): Trade | null {
    if (action.name === marketExecutedEventParser.eventName) {
      const event = marketExecutedEventParser.actionParser(action);

      return event.args.open ? event.args.t : null;
    }

    if (!trade) {
      return null;
    }

    if (action.name === leverageUpdateExecutedEventParser.eventName) {
      const event = leverageUpdateExecutedEventParser.actionParser(action);

      return {
        ...trade,
        leverage: Number(event.args.values.newLeverage),
        collateralAmount: event.args.values.newCollateralAmount,
      } as Trade;
    }

    if (action.name === positionSizeIncreaseExecutedEventParser.eventName) {
      const event =
        positionSizeIncreaseExecutedEventParser.actionParser(action);

      return {
        ...trade,
        collateralAmount: event.args.values.newCollateralAmount,
        leverage: Number(event.args.values.newLeverage),
        openPrice: event.args.values.newOpenPrice,
      } as Trade;
    }

    if (action.name === positionSizeDecreaseExecutedEventParser.eventName) {
      const event =
        positionSizeDecreaseExecutedEventParser.actionParser(action);

      return {
        ...trade,
        collateralAmount: event.args.values.newCollateralAmount,
        leverage: Number(event.args.values.newLeverage),
      } as Trade;
    }

    return trade;
  }

  private getMarketExecutedSourceArgs(task: SimulationTask, trade: Trade) {
    if (task.action.name === marketExecutedEventParser.eventName) {
      return marketExecutedEventParser.actionParser(task.action).args;
    }

    return {
      open: false,
      orderId: {
        user: trade.user,
        index: trade.index,
      },
      t: trade,
      user: trade.user,
      index: trade.index,
      collateralPriceUsd: 100_000_000n,
      oraclePrice: this.getClosePrice(task),
      amountSentToTrader: 0n,
    };
  }

  private getClosePrice(task: SimulationTask) {
    if (task.action.name === marketExecutedEventParser.eventName) {
      const event = marketExecutedEventParser.actionParser(task.action);

      return BigInt(event.args.oraclePrice || event.args.t.openPrice);
    }

    if (task.action.name === CloseMissionAction) {
      const args = bigIntSafeJsonParse<{ expectedPrice: string }>(
        task.action.args,
      );

      return BigInt(args.expectedPrice);
    }

    return 0n;
  }

  private getFollowerPosition(task: SimulationTask) {
    if (!task.mission.achievePositionKey) {
      return null;
    }

    return parseGnsPositionKey(task.mission.achievePositionKey);
  }

  private getFollowerCollateral(task: SimulationTask) {
    const collateralIndex = this.getFollowerCollateralIndex(task);

    if (collateralIndex === null) {
      return null;
    }

    return getCollateral(
      task.mission.bot.followerContract.chainId,
      collateralIndex,
    );
  }

  private getFollowerCollateralIndex(task: SimulationTask) {
    return (
      MainCollateralIndex[
        task.mission.bot.followerContract
          .chainId as keyof typeof MainCollateralIndex
      ] ?? null
    );
  }

  private getLeaderCollateral(task: SimulationTask): Collateral | null {
    if (task.action.name === marketExecutedEventParser.eventName) {
      const args = marketExecutedEventParser.actionParser(task.action).args;

      return getCollateral(
        task.mission.bot.leaderContract.chainId,
        args.t.collateralIndex,
      );
    }

    if (
      task.action.name === positionSizeIncreaseExecutedEventParser.eventName
    ) {
      const args = positionSizeIncreaseExecutedEventParser.actionParser(
        task.action,
      ).args;

      return getCollateral(
        task.mission.bot.leaderContract.chainId,
        args.collateralIndex,
      );
    }

    return null;
  }

  private usdcToCollateralAmount(amount: bigint, collateral: Collateral) {
    return (amount * BigInt(collateral.precision)) / 1_000_000n;
  }

  private getPositionSizeCollateral(trade: Trade) {
    return (BigInt(trade.collateralAmount) * BigInt(trade.leverage)) / 1_000n;
  }

  private calculatePnlCollateral(trade: Trade, price: bigint) {
    const openPrice = Number(trade.openPrice);
    const closePrice = Number(price);
    const collateralAmount = Number(trade.collateralAmount);
    const leverage = Number(trade.leverage) / 1_000;

    if (openPrice <= 0) {
      return 0n;
    }

    const priceDeltaRatio = trade.long
      ? (closePrice - openPrice) / openPrice
      : (openPrice - closePrice) / openPrice;

    return BigInt(Math.floor(collateralAmount * leverage * priceDeltaRatio));
  }

  private calculateAmountSentToTrader(trade: Trade, price: bigint) {
    const amount =
      BigInt(trade.collateralAmount) +
      this.calculatePnlCollateral(trade, price);

    return amount > 0n ? amount : 0n;
  }

  private calculatePartialPnlCollateral(
    trade: Trade,
    price: bigint,
    existingPositionSizeCollateral: bigint,
    positionSizeCollateralDelta: bigint,
  ) {
    if (existingPositionSizeCollateral <= 0n) {
      return 0n;
    }

    const ratio =
      Number(positionSizeCollateralDelta) /
      Number(existingPositionSizeCollateral);
    const pnl = this.calculatePnlCollateral(trade, price);

    return BigInt(Math.floor(Number(pnl) * ratio));
  }

  private createAwaitingExecution(
    task: SimulationTask,
    eventName: string,
    positionKey: string,
    address: string,
    args: unknown,
    offset: number,
    message: string,
  ): SimulationTaskExecution {
    // Keep the live lifecycle: execution moves to Await, then the
    // follower action handler marks the task Completed from the virtual event.
    return {
      status: TaskStatus.Await,
      message,
      actionItem: {
        item: eventToAction(eventName, positionKey, address, args),
        blockNumber: task.action.blockNumber,
        logIndex: this.getVirtualLogIndex(task, offset),
      },
    };
  }

  private createStoppedExecution(message: string): SimulationTaskExecution {
    return {
      status: TaskStatus.Stopped,
      message,
    };
  }

  private getVirtualLogIndex(
    task: {
      id: number;
      action: {
        orderInBlock: number;
      };
    },
    offset: number,
  ) {
    return task.action.orderInBlock + task.id * 10 + offset;
  }
}
