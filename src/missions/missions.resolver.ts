import {
  Resolver,
  Query,
  Args,
  Int,
  Mutation,
  Subscription,
} from '@nestjs/graphql';
import { Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { MissionsService } from './missions.service';
import { MissionShallowDetails } from './entities/mission.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver(() => MissionShallowDetails)
export class MissionsResolver {
  constructor(
    private readonly missionsService: MissionsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => MissionShallowDetails)
  closeMission(@Args('id', { type: () => Int }) id: number) {
    return this.missionsService.closeMission(id);
  }

  @Query(() => [MissionShallowDetails])
  getAllMissions() {
    return this.missionsService.findAll();
  }

  @Subscription(() => MissionShallowDetails, {
    name: SUBSCRIPTION_TOKEN.missionAdded,
  })
  subscribeToMissionAdded() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionAdded);
  }

  @Subscription(() => MissionShallowDetails, {
    name: SUBSCRIPTION_TOKEN.missionUpdated,
  })
  subscribeToMissionUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.missionUpdated);
  }
}
