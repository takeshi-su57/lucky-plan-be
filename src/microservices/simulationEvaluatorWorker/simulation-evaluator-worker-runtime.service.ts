import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

import { SimulationEvaluatorWorkerClientService } from './simulation-evaluator-worker-client.service';
import { SimulationEvaluatorWorkerEvaluationService } from './simulation-evaluator-worker-evaluation.service';

@Injectable()
export class SimulationEvaluatorWorkerRuntimeService
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly client: SimulationEvaluatorWorkerClientService,
    private readonly evaluator: SimulationEvaluatorWorkerEvaluationService,
  ) {}

  private heartbeat?: NodeJS.Timeout;
  private approved = false;
  private heartbeatInFlight = false;

  onModuleInit() {
    this.heartbeat = setInterval(
      () => void this.sendHeartbeat(),
      SIMULATION_EVALUATOR.heartbeatIntervalMs,
    );
    void this.run();
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  private async run() {
    while (true) {
      try {
        if (!this.approved) {
          const enrollment = await this.client.joinHeartbeat();
          this.approved = enrollment.authorizationStatus === 'Approved';
          if (!this.approved) {
            await this.delay(SIMULATION_EVALUATOR.enrollmentRetryDelayMs);
            continue;
          }
        }

        const { task } = await this.client.poll();

        if (!task) {
          await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
          continue;
        }

        await this.processTask(task);
      } catch (error) {
        console.error('[simulation-evaluator-worker]', error);
        await this.delay(SIMULATION_EVALUATOR.enrollmentRetryDelayMs);
      }
    }
  }

  private async processTask(task: {
    id: string;
    kind: SimulationEvaluatorTaskKind;
    leaseToken: string;
  }) {
    this.client.beginTask(task.id, task.leaseToken);
    try {
      const { input } = await this.client.getInput(task.id, task.leaseToken);
      let result: Record<string, unknown>;
      switch (task.kind) {
        case SimulationEvaluatorTaskKind.EvaluateLeaders:
          result = await this.evaluator.evaluate(
            task.id,
            task.leaseToken,
            input,
          );
          break;
        case SimulationEvaluatorTaskKind.PrebuildPlatformCache:
          result = await this.evaluator.prebuildPlatformCache(
            task.id,
            task.leaseToken,
            input,
          );
          break;
        default:
          throw new Error(
            `Unsupported simulation evaluator task kind: ${task.kind}`,
          );
      }
      await this.client.complete(task.id, task.leaseToken, result);
    } catch (error) {
      await this.client
        .fail(
          task.id,
          task.leaseToken,
          error instanceof Error ? error.message : String(error),
        )
        .catch(() => undefined);
      console.error('[simulation-evaluator-worker] task failed', error);
    } finally {
      this.client.endTask(task.id);
    }
  }

  private async sendHeartbeat() {
    if (this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      if (!this.approved) return;
      await this.client.heartbeat();
    } catch (error) {
      console.error('[simulation-evaluator-worker] heartbeat failed', error);
      this.approved = false;
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
