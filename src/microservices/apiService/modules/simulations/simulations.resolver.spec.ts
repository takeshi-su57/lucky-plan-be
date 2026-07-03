import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from '@jest/globals';
import { UserPermission } from 'generated/prisma/client';

import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { SimulationsResolver } from './simulations.resolver';

function getMethodMetadata(methodName: keyof SimulationsResolver) {
  const handler = SimulationsResolver.prototype[methodName];

  return {
    guards: Reflect.getMetadata(GUARDS_METADATA, handler),
    roles: Reflect.getMetadata(ROLES_KEY, handler),
  };
}

describe('SimulationsResolver authorization', () => {
  it.each([
    'deleteSimulation',
    'deleteSimulationResearch',
    'deleteSimulationPlan',
    'deleteSimulationBot',
  ] as Array<keyof SimulationsResolver>)(
    'requires admin auth for %s',
    (methodName) => {
      const metadata = getMethodMetadata(methodName);

      expect(metadata.roles).toEqual([UserPermission.Admin]);
      expect(metadata.guards).toEqual([GqlAuthGuard, RolesGuard]);
    },
  );

  it.each([
    'createSimulation',
    'createSimulationResearch',
    'updateSimulation',
    'playAutoSimulation',
    'cancelSimulation',
    'createSimulationPlan',
    'updateSimulationBot',
    'batchCreateSimulationBots',
    'playSimulationPlan',
    'stopSimulationBot',
  ] as Array<keyof SimulationsResolver>)(
    'requires trader auth for %s',
    (methodName) => {
      const metadata = getMethodMetadata(methodName);

      expect(metadata.roles).toEqual([UserPermission.Trader]);
      expect(metadata.guards).toEqual([GqlAuthGuard, RolesGuard]);
    },
  );
});
