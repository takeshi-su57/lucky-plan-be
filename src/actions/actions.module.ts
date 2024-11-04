import { Module } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { ActionsResolver } from './actions.resolver';

@Module({
  providers: [ActionsResolver, ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
