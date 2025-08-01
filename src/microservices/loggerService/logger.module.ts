import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';

import { LeaderboardController } from './logger.controller';

import { GlobalModule } from '../../global/global.module';
import { WalletAccountsModule } from '../../wallet-accounts/wallet-accounts.module';
import { AuthModule } from '../../auth/auth.module';
import { LogsModule } from '../../loggers/logs.module';
import { SecurityService } from './logger.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ClientsModule.register([
      {
        name: 'REDIS_SERVICE',
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
      },
    ]),
    ScheduleModule.forRoot(),
    WalletAccountsModule,
    AuthModule,
    GlobalModule,
    LogsModule,
  ],
  controllers: [LeaderboardController],
  providers: [SecurityService],
})
export class LeaderboardModule {}
