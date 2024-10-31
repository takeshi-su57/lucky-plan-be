import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaService } from './services/prisma.service';
import { ClientService } from './services/client.service';
import { TradeService } from './services/trade.service';
import { SystemService } from './services/system.service';
import { ContractMonitorService } from './services/contract-monitor.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    ClientService,
    TradeService,
    SystemService,
    ContractMonitorService,
  ],
})
export class AppModule {}
