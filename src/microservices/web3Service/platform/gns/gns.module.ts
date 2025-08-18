import { Module } from '@nestjs/common';
import { GnsController } from './gns.controller';
import { GnsService } from './gns.service';
import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';

@Module({
  imports: [ContractsModule],
  controllers: [GnsController],
  providers: [GnsService],
})
export class GnsModule {}
