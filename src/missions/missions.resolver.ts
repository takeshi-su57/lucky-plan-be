import { Resolver, Args, Int, Mutation, Subscription } from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { MissionsService } from './missions.service';
import { MissionBackwardDetails } from './entities/mission.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';

@Resolver()
export class MissionsResolver {
  constructor(
    private readonly missionsService: MissionsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  closeMission(
    @Args('id', { type: () => Int }) id: number,
    @Args('isForce', { type: () => Boolean }) isForce: boolean,
  ) {
    return this.missionsService.closeMission(id, isForce);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  ignoreMission(@Args('id', { type: () => Int }) id: number) {
    return this.missionsService.ignoreMission(id);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionCreated,
  })
  @UseGuards(GqlAuthGuard)
  subscribeToMissionCreated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionCreated);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionUpdated,
  })
  @UseGuards(GqlAuthGuard)
  subscribeToMissionUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionUpdated);
  }
}
