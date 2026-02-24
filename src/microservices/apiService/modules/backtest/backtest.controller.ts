import {
  Controller,
  Inject,
  Post,
  Body,
  Param,
  Get,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { BacktestTask, BacktestResult, ValidationPipeline, ValidationCandidate } from './entities';
import { BacktestService } from './backtest.service';
import { StrategyConfig } from 'src/backtest/core/interfaces';
import { InternalApiGuard } from './internal-api.guard';

/**
 * Request body for run-single endpoint
 */
interface RunSingleRequest {
  taskId: string;
  configId: string;
  strategyConfig: StrategyConfig;
}

/**
 * Request body for complete-task endpoint
 */
interface CompleteTaskRequest {
  bestConfigIds: string[];
}

/**
 * Request body for fail-task endpoint
 */
interface FailTaskRequest {
  error: string;
}

/**
 * Request body for heartbeat endpoint
 */
interface HeartbeatRequest {
  currentTrial?: number;
  trialProgress?: string; // "sampling" | "evaluating" | "completed"
}

@Controller('backtest')
export class BacktestController {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private readonly backtestService: BacktestService,
  ) {}

  // ==================== HTTP ENDPOINTS FOR OPTIMIZER.PY ====================

  /**
   * Run a single backtest and return score
   * Called by optimizer.py for each Optuna trial
   * Protected by internal API secret (BACKTEST_INTERNAL_SECRET env var)
   */
  @Post('run-single')
  @UseGuards(InternalApiGuard)
  async runSingle(@Body() body: RunSingleRequest) {
    try {
      const result = await this.backtestService.runSingleBacktest(
        body.taskId,
        body.configId,
        body.strategyConfig,
      );

      return result;
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          score: -1e100, // Cannot use Infinity - JSON serializes it as null
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Mark task as complete with best params
   * Called by optimizer.py when optimization finishes successfully
   */
  @Post('task/:id/complete')
  @UseGuards(InternalApiGuard)
  async completeTask(
    @Param('id') taskId: string,
    @Body() body: CompleteTaskRequest,
  ) {
    try {
      const task = await this.backtestService.completeOptunaTask(
        taskId,
        body.bestConfigIds,
      );

      return { success: true, task };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Mark task as failed
   * Called by optimizer.py when optimization fails
   */
  @Post('task/:id/fail')
  @UseGuards(InternalApiGuard)
  async failTask(@Param('id') taskId: string, @Body() body: FailTaskRequest) {
    try {
      const task = await this.backtestService.failOptunaTask(
        taskId,
        body.error,
      );

      return { success: true, task };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Check if task is cancelled
   * Called by optimizer.py to poll for cancellation
   */
  @Get('task/:id/cancelled')
  @UseGuards(InternalApiGuard)
  async isTaskCancelled(@Param('id') taskId: string) {
    try {
      const cancelled = await this.backtestService.isTaskCancelled(taskId);
      return { cancelled };
    } catch (error) {
      throw new HttpException(
        {
          cancelled: false,
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Receive heartbeat from optimizer.py
   * Updates lastHeartbeat timestamp and optional progress info
   * Returns current task status for cancellation detection
   */
  @Post('task/:id/heartbeat')
  @UseGuards(InternalApiGuard)
  async receiveHeartbeat(
    @Param('id') taskId: string,
    @Body() body: HeartbeatRequest,
  ) {
    try {
      const result = await this.backtestService.recordHeartbeat(
        taskId,
        body.currentTrial,
        body.trialProgress,
      );

      return result;
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Handle optimizer reconnection after NestJS restart
   * Returns task state for optimizer to decide whether to continue
   */
  @Get('task/:id/reconnect')
  @UseGuards(InternalApiGuard)
  async handleReconnect(@Param('id') taskId: string) {
    try {
      const result = await this.backtestService.handleReconnect(taskId);
      return result;
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          shouldContinue: false,
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }


  // ==================== REDIS EVENT HANDLERS ====================

  @EventPattern(PATTERNS.Backtest.TaskUpdated)
  async handleBacktestTaskUpdated(@Payload() task: BacktestTask) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.backtestTaskUpdated, {
      [SUBSCRIPTION_TOKEN.backtestTaskUpdated]: task,
    });
  }

  @EventPattern(PATTERNS.Backtest.ResultCreated)
  async handleBacktestResultCreated(@Payload() result: BacktestResult) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.backtestResultCreated, {
      [SUBSCRIPTION_TOKEN.backtestResultCreated]: result,
    });
  }

  @EventPattern(PATTERNS.Validation.PipelineUpdated)
  async handleValidationPipelineUpdated(@Payload() pipeline: ValidationPipeline) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.validationPipelineUpdated, {
      [SUBSCRIPTION_TOKEN.validationPipelineUpdated]: pipeline,
    });
  }

  @EventPattern(PATTERNS.Validation.CandidateUpdated)
  async handleValidationCandidateUpdated(@Payload() candidate: ValidationCandidate) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.validationCandidateUpdated, {
      [SUBSCRIPTION_TOKEN.validationCandidateUpdated]: candidate,
    });
  }
}
