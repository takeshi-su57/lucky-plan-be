import { Resolver, Args, Int, Mutation, Subscription } from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { User, UserPermission } from '@prisma/client';

import { MissionsService } from './missions.service';
import { MissionBackwardDetails } from './entities/mission.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { CurrentUser } from 'src/auth/user.decorator';
import { Roles } from 'src/auth/roles.decorator';
import { RolesGuard } from 'src/auth/gql-role.guard';

@Resolver()
export class MissionsResolver {
  constructor(
    private readonly missionsService: MissionsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  closeMission(
    @Args('id', { type: () => Int }) id: number,
    @Args('isForce', { type: () => Boolean }) isForce: boolean,
    @CurrentUser() user: User,
  ) {
    return this.missionsService.closeMission(user.address, id, isForce);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  ignoreMission(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.missionsService.ignoreMission(user.address, id);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionCreated,
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  subscribeToMissionCreated(@CurrentUser() _user: User) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionCreated);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionUpdated,
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  subscribeToMissionUpdated(@CurrentUser() _user: User) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionUpdated);
  }
}
