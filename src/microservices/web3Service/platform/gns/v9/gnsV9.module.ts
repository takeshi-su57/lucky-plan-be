import { Module } from '@nestjs/common';
import { GnsV9Controller } from './gnsV9.controller';
import { GnsV9Service } from './gnsV9.service';

@Module({
  imports: [],
  controllers: [GnsV9Controller],
  providers: [GnsV9Service],
})
export class GnsV9Module {}
