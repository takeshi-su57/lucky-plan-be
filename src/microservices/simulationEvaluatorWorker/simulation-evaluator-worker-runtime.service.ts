import { Injectable, OnModuleInit } from '@nestjs/common';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

import { SimulationEvaluatorWorkerClientService } from './simulation-evaluator-worker-client.service';
import { SimulationEvaluatorWorkerEvaluationService } from './simulation-evaluator-worker-evaluation.service';

@Injectable()
export class SimulationEvaluatorWorkerRuntimeService implements OnModuleInit {
  constructor(
    private readonly client: SimulationEvaluatorWorkerClientService,
    private readonly evaluator: SimulationEvaluatorWorkerEvaluationService,
  ) {}

  onModuleInit() {
    void this.run();
  }

  private async run() {
    while (true) {
      try {
        const enrollment = await this.client.enroll();

        if (enrollment.authorizationStatus !== 'Approved') {
          await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
          continue;
        }

        await this.client.presence();

        const { task } = await this.client.poll();

        if (!task) {
          await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
          continue;
        }

        await this.processTask(task);
      } catch (error) {
        console.error('[simulation-evaluator-worker]', error);
        await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
      }
    }
  }

  private async processTask(task: {
    id: string;
    kind: SimulationEvaluatorTaskKind;
    leaseToken: string;
  }) {
    const heartbeat = setInterval(() => {
      void this.client.heartbeat(task.id, task.leaseToken).catch((error) => {
        console.error('[simulation-evaluator-worker] heartbeat failed', error);
      });
    }, SIMULATION_EVALUATOR.heartbeatIntervalMs);

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
      throw error;
    } finally {
      clearInterval(heartbeat);
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
