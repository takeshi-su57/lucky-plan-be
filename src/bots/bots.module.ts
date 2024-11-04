import { Module } from '@nestjs/common';
import { BotsService } from './bots.service';
import { BotsResolver } from './bots.resolver';

@Module({
  providers: [BotsResolver, BotsService],
  exports: [BotsService],
})
export class BotsModule {}
