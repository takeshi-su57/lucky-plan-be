/**
 * Worker Pool Service
 *
 * NestJS service that manages a pool of worker threads for running backtests.
 * Provides non-blocking backtest execution to prevent event loop blocking.
 */
import * as path from 'path';
import { Worker } from 'worker_threads';
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';

import { WorkerInput, WorkerResult } from './backtest.worker';

/**
 * Task waiting to be executed by a worker
 */
interface WorkerTask {
  input: WorkerInput;
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
}

/**
 * Worker pool state tracking
 */
interface WorkerInfo {
  worker: Worker;
  busy: boolean;
}

@Injectable()
export class WorkerPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerPoolService.name);
  private workers: WorkerInfo[] = [];
  private taskQueue: WorkerTask[] = [];
  private readonly poolSize = 2; // Fixed pool size as requested
  private workerPath: string = '';
  private isInitialized = false;

  async onModuleInit(): Promise<void> {
    this.initializeWorkerPath();
    await this.initializePool();
    this.isInitialized = true;
    this.logger.log(`Worker pool initialized with ${this.poolSize} workers`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
    this.logger.log('Worker pool shut down');
  }

  /**
   * Initialize the worker file path
   * Handles both development (ts-node) and production (compiled js) environments
   */
  private initializeWorkerPath(): void {
    // Determine if running in compiled mode
    const isCompiled = __filename.endsWith('.js');

    if (isCompiled) {
      // Production: use compiled .js file
      this.workerPath = path.join(__dirname, 'backtest.worker.js');
    } else {
      // Development: use ts-node with .ts file
      this.workerPath = path.join(__dirname, 'backtest.worker.ts');
    }

    this.logger.debug(`Worker path: ${this.workerPath}`);
  }

  /**
   * Initialize the worker pool
   */
  private async initializePool(): Promise<void> {
    for (let i = 0; i < this.poolSize; i++) {
      // Workers are created on-demand when tasks are assigned
      this.workers.push({
        worker: null as unknown as Worker,
        busy: false,
      });
    }
  }

  /**
   * Create a new worker for a task
   */
  private createWorker(input: WorkerInput): Worker {
    const isCompiled = __filename.endsWith('.js');

    const workerOptions = isCompiled
      ? { workerData: input }
      : {
          workerData: input,
          execArgv: ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register'],
        };

    return new Worker(this.workerPath, workerOptions);
  }

  /**
   * Run a backtest in a worker thread
   * Returns a promise that resolves with the backtest result
   */
  async runBacktest(input: WorkerInput): Promise<WorkerResult> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = { input, resolve, reject };

      // Try to find an available worker slot
      const availableIndex = this.workers.findIndex((w) => !w.busy);

      if (availableIndex !== -1) {
        this.executeTask(availableIndex, task);
      } else {
        // All workers busy, queue the task
        this.taskQueue.push(task);
        this.logger.debug(`Task queued. Queue size: ${this.taskQueue.length}`);
      }
    });
  }

  /**
   * Execute a task on a specific worker slot
   */
  private executeTask(workerIndex: number, task: WorkerTask): void {
    const workerInfo = this.workers[workerIndex];
    workerInfo.busy = true;

    // Create a new worker for this task
    const worker = this.createWorker(task.input);
    workerInfo.worker = worker;

    this.logger.debug(
      `Worker ${workerIndex} executing backtest for config ${task.input.configId}`,
    );

    // Handle worker completion
    worker.on('message', (result: WorkerResult) => {
      task.resolve(result);
      this.onWorkerComplete(workerIndex);
    });

    // Handle worker errors
    worker.on('error', (error: Error) => {
      this.logger.error(`Worker ${workerIndex} error: ${error.message}`);
      task.reject(error);
      this.onWorkerComplete(workerIndex);
    });

    // Handle worker exit
    worker.on('exit', (code: number) => {
      if (code !== 0) {
        this.logger.warn(`Worker ${workerIndex} exited with code ${code}`);
      }
    });
  }

  /**
   * Handle worker completion and process queued tasks
   */
  private onWorkerComplete(workerIndex: number): void {
    const workerInfo = this.workers[workerIndex];

    // Terminate the completed worker
    if (workerInfo.worker) {
      workerInfo.worker.terminate().catch(() => {
        // Ignore termination errors
      });
    }

    workerInfo.busy = false;

    // Process next queued task if available
    if (this.taskQueue.length > 0) {
      const nextTask = this.taskQueue.shift()!;
      this.logger.debug(
        `Processing queued task. Remaining in queue: ${this.taskQueue.length}`,
      );
      this.executeTask(workerIndex, nextTask);
    }
  }

  /**
   * Get current pool status
   */
  getStatus(): {
    poolSize: number;
    busyWorkers: number;
    queuedTasks: number;
    isInitialized: boolean;
  } {
    return {
      poolSize: this.poolSize,
      busyWorkers: this.workers.filter((w) => w.busy).length,
      queuedTasks: this.taskQueue.length,
      isInitialized: this.isInitialized,
    };
  }

  /**
   * Shutdown all workers
   */
  private async shutdown(): Promise<void> {
    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error('Worker pool shutting down'));
    }
    this.taskQueue = [];

    // Terminate all workers
    const terminationPromises = this.workers.map(async (workerInfo) => {
      if (workerInfo.worker) {
        try {
          await workerInfo.worker.terminate();
        } catch {
          // Ignore termination errors
        }
      }
    });

    await Promise.all(terminationPromises);
    this.workers = [];
  }
}
