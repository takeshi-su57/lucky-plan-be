import { Resolver, Args, Int, Mutation, Subscription } from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { User, UserPermission } from '@prisma/client';

import { MissionsService } from './missions.service';
import {
  ManualParams,
  MissionBackwardDetails,
} from './entities/mission.entity';

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
  cloneMission(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
    @Args('manualParams', { type: () => ManualParams, nullable: true })
    manualParams?: ManualParams,
  ) {  
    return this.missionsService.cloneMission(user.address, id, manualParams);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  closeMission(
    @Args('id', { type: () => Int }) id: number,
    @Args('isForce', { type: () => Boolean }) isForce: boolean,
    @CurrentUser() user: User,
  ) {
    return this.missionsService.closeMission(
      user.address.toLowerCase(),
      id,
      isForce,
    );
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
    filter: (payload, variables) => {
      if (payload.missionCreated.length > 0) {
        return payload.missionCreated[0].bot.plan.userId === variables.userId;
      }

      return false;
    },
  })
  subscribeToMissionCreated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionCreated);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionUpdated,
    filter: (payload, variables) => {
      if (payload.missionUpdated.length > 0) {
        return payload.missionUpdated[0].bot.plan.userId === variables.userId;
      }

      return false;
    },
  })
  subscribeToMissionUpdated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionUpdated);
  }
}
