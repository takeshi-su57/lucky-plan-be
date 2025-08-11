import { Module } from '@nestjs/common';
import { GnsV9Controller } from './gnsV9.controller';
import { GnsV9Service } from './gnsV9.service';
import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';

@Module({
  imports: [ContractsModule],
  controllers: [GnsV9Controller],
  providers: [GnsV9Service],
})
export class GnsV9Module {}
