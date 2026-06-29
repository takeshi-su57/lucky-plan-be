import { describe, expect, it } from '@jest/globals';
import { SimulationStatus } from 'generated/prisma/enums';

import { SimulationsService } from './simulations.service';

describe('SimulationsService queue ordering', () => {
  it('orders stale running simulations before paused and created rows', () => {
    expect(
      SimulationsService.getAutomationStatusPriority(SimulationStatus.Running),
    ).toBe(0);
    expect(
      SimulationsService.getAutomationStatusPriority(SimulationStatus.Paused),
    ).toBe(1);
    expect(
      SimulationsService.getAutomationStatusPriority(SimulationStatus.Created),
    ).toBe(2);
    expect(
      SimulationsService.getAutomationStatusPriority(
        SimulationStatus.Completed,
      ),
    ).toBe(99);
  });
});
