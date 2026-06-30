import { describe, expect, it } from '@jest/globals';
import { SimulationStatus } from 'generated/prisma/enums';

import { SimulationAutoRunnerService } from './simulation-auto-runner.service';

describe('SimulationAutoRunnerService queue helpers', () => {
  it('reports whether a simulation id is active locally', () => {
    const service = Object.create(
      SimulationAutoRunnerService.prototype,
    ) as SimulationAutoRunnerService;

    (
      service as unknown as { activeAutoSimulationRunIds: Set<number> }
    ).activeAutoSimulationRunIds = new Set([7]);

    expect(service.isAutoSimulationActive(7)).toBe(true);
    expect(service.isAutoSimulationActive(8)).toBe(false);
  });

  it('uses Paused as the terminal status for a partial queued run', () => {
    expect(
      SimulationAutoRunnerService.getTerminalStatusForHorizon({
        cursor: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toBe(SimulationStatus.Paused);
  });

  it('uses Completed as the terminal status when the cursor reaches endAt', () => {
    expect(
      SimulationAutoRunnerService.getTerminalStatusForHorizon({
        cursor: new Date('2026-10-01T00:00:00.000Z'),
        endAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toBe(SimulationStatus.Completed);
  });
});
