import { Resolver, Args, Int, Mutation, Subscription } from '@nestjs/graphql';
import { Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { MissionsService } from './missions.service';
import { MissionBackwardDetails } from './entities/mission.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver()
export class MissionsResolver {
  constructor(
    private readonly missionsService: MissionsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => MissionBackwardDetails)
  closeMission(
    @Args('id', { type: () => Int }) id: number,
    @Args('isForce', { type: () => Boolean }) isForce: boolean,
  ) {
    return this.missionsService.closeMission(id, isForce);
  }

  @Mutation(() => MissionBackwardDetails)
  ignoreMission(@Args('id', { type: () => Int }) id: number) {
    return this.missionsService.ignoreMission(id);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionAdded,
  })
  subscribeToMissionAdded() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionAdded);
  }

  @Subscription(() => [MissionBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.missionUpdated,
  })
  subscribeToMissionUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionUpdated);
  }
}
