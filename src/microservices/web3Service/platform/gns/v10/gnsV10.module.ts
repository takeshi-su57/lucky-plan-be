import { Module } from '@nestjs/common';
import { GnsV10Controller } from './gnsV10.controller';
import { GnsV10Service } from './gnsV10.service';

@Module({
  imports: [],
  controllers: [GnsV10Controller],
  providers: [GnsV10Service],
})
export class GnsV10Module {}
