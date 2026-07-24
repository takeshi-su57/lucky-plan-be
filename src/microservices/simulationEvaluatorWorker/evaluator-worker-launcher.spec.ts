import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

const launcherPath = resolve(
  __dirname,
  '../../../scripts/evaluator-worker-launcher.js',
);

const decision = (exitCode: number, pendingUpdateExists: boolean) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `const launcher = require(${JSON.stringify(launcherPath)}); process.stdout.write(JSON.stringify({ code: launcher.EVALUATOR_WORKER_UPGRADE_EXIT_CODE, restart: launcher.shouldRestartAfterUpgrade(${exitCode}, ${pendingUpdateExists}) }));`,
      ],
      { encoding: 'utf8' },
    ),
  ) as { code: number; restart: boolean };

describe('evaluator worker launcher', () => {
  it('restarts immediately for the dedicated upgrade exit code', () => {
    expect(decision(75, false)).toEqual({ code: 75, restart: true });
  });

  it('applies a staged update even when the worker exits unexpectedly', () => {
    expect(decision(1, true).restart).toBe(true);
  });

  it('returns ordinary worker exits to the operating-system supervisor', () => {
    expect(decision(1, false).restart).toBe(false);
    expect(decision(0, false).restart).toBe(false);
  });
});
