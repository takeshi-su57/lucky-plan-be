import { Module } from '@nestjs/common';

import { UsersModule } from 'src/users/users.module';
import { ContractsModule } from 'src/contracts/contracts.module';

import { BotsService } from './bots.service';
import { BotsResolver } from './bots.resolver';

@Module({
  imports: [UsersModule, ContractsModule],
  providers: [BotsResolver, BotsService],
  exports: [BotsService],
})
export class BotsModule {}
