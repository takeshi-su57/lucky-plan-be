import { Module } from '@nestjs/common';

import { PositionsModule } from 'src/positions/positions.module';

import { ActionsService } from './actions.service';
import { ActionsResolver } from './actions.resolver';

@Module({
  imports: [PositionsModule],
  providers: [ActionsResolver, ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
