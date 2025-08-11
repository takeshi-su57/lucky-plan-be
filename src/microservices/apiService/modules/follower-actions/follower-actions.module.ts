import { Module } from '@nestjs/common';
import { FollowerActionsService } from './follower-actions.service';

@Module({
  providers: [FollowerActionsService],
  exports: [FollowerActionsService],
})
export class FollowerActionsModule {}
