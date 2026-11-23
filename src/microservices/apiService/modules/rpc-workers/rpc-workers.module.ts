import { Module } from '@nestjs/common';

import { RpcWorkersResolver } from './rpc-workers.resolver';
import { RpcWorkersService } from './rpc-workers.service';

@Module({
  providers: [RpcWorkersResolver, RpcWorkersService],
})
export class RpcWorkersModule {}
