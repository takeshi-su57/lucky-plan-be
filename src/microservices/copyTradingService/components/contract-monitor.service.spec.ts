import { describe, expect, it, jest } from '@jest/globals';
import { ContractStatus, Platform, Version } from 'generated/prisma/client';

import { ContractMonitorService } from './contract-monitor.service';

jest.mock('src/web3/web3/evm-adapter.service', () => ({
  EvmAdapterService: class {},
}));

describe('ContractMonitorService', () => {
  it('emits checkpoint batches even when a contract has no matching events', async () => {
    const service = new ContractMonitorService(
      {} as never,
      {
        getBlockNumber: jest.fn(async () => 100n),
        getLogs: jest.fn(async () => []),
      } as never,
      { log: jest.fn(async () => undefined) } as never,
    );

    const batches = await service.scanContract({
      id: 7,
      status: ContractStatus.Live,
      platform: Platform.GMX,
      version: Version.V2,
      chainId: 42161,
      address: '0x0000000000000000000000000000000000000001',
      fromBlock: 1,
      lastBlockNumber: 0,
    } as never);

    expect(batches).toEqual([
      expect.objectContaining({
        blockNumber: 100,
        actionItems: [],
      }),
    ]);
  });
});
