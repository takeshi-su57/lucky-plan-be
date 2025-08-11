import { Module } from '@nestjs/common';
import { GnsV10Controller } from './gnsV10.controller';
import { GnsV10Service } from './gnsV10.service';
import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';

@Module({
  imports: [ContractsModule],
  controllers: [GnsV10Controller],
  providers: [GnsV10Service],
})
export class GnsV10Module {}
