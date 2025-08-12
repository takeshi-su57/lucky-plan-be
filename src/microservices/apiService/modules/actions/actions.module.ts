import { Module } from '@nestjs/common';

import { PositionsModule } from 'src/microservices/apiService/modules/positions/positions.module';

import { ActionsService } from './actions.service';

@Module({
  imports: [PositionsModule],
  providers: [ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
