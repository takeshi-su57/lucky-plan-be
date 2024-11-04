import { Module } from '@nestjs/common';
import { FollowerService } from './follower.service';
import { FollowerResolver } from './follower.resolver';

@Module({
  providers: [FollowerResolver, FollowerService],
})
export class FollowerModule {}
