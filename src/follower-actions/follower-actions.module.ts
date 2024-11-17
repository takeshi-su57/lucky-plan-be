import { Module } from '@nestjs/common';
import { FollowerActionsService } from './follower-actions.service';
import { FollowerActionsResolver } from './follower-actions.resolver';

@Module({
  providers: [FollowerActionsResolver, FollowerActionsService],
  exports: [FollowerActionsService],
})
export class FollowerActionsModule {}
