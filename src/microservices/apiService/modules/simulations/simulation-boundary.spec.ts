import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from '@jest/globals';

describe('API simulation module boundary', () => {
  const moduleDir = __dirname;

  it('does not keep analytics execution files in the API module', () => {
    const analyticsOwnedFiles = [
      'simulation-auto-runner.service.ts',
      'simulation-leader-evaluator.service.ts',
      'simulation-cache.service.ts',
      'simulation-automation-queue.utils.ts',
      'simulation-automation.utils.ts',
      'simulation-range.utils.ts',
      'simulation.constants.ts',
    ];

    expect(
      analyticsOwnedFiles.filter((fileName) =>
        existsSync(join(moduleDir, fileName)),
      ),
    ).toEqual([]);
  });

  it('does not import analytics runtime internals from API simulation services', () => {
    const apiServiceFiles = [
      'simulations.service.ts',
      'simulation-plans.service.ts',
      'simulations.module.ts',
      'simulations.resolver.ts',
    ];
    const forbiddenPatterns = [
      'analyticsService/modules/simulations',
      'SimulationAutoRunnerService',
      'SimulationCacheService',
      'SimulationLeaderEvaluatorService',
      'processNextQueuedAutoSimulation',
      'getAutomationStatusPriority',
    ];

    const violations = apiServiceFiles.flatMap((fileName) => {
      const source = readFileSync(join(moduleDir, fileName), 'utf8');

      return forbiddenPatterns
        .filter((pattern) => source.includes(pattern))
        .map((pattern) => `${fileName}: ${pattern}`);
    });

    expect(violations).toEqual([]);
  });
});
