import { Platform } from '@prisma/client';

export type CreateEventLogInput = {
  contractId: number;

  jsonLog: string;

  block: number;

  logIndex: number;

  date: Date;
};

export type CreatePerpTradingEventLogInput = {
  contractId: number;

  platform: Platform;

  address: string;

  jsonLog: string;

  usdPnl: number;

  block: number;

  logIndex: number;

  date: Date;
};
