import { Module } from '@nestjs/common';

import { UsersModule } from 'src/users/users.module';
import { MissionsModule } from 'src/missions/missions.module';

import { BotsService } from './bots.service';
import { BotsResolver } from './bots.resolver';

import { ActionsModule } from 'src/actions/actions.module';
import { FollowerModule } from 'src/follower/follower.module';

@Module({
  imports: [UsersModule, MissionsModule, ActionsModule, FollowerModule],
  providers: [BotsResolver, BotsService],
  exports: [BotsService],
})
export class BotsModule {}
