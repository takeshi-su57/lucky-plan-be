import { Inject } from '@nestjs/common';
import { Resolver, Query, Args, Int, Subscription } from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

import { FollowerActionsService } from './follower-actions.service';
import {
  FollowerAction,
  FollowerActionDetails,
} from './entities/follower-action.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver(() => FollowerAction)
export class FollowerActionsResolver {
  constructor(
    private readonly followerActionsService: FollowerActionsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => [FollowerAction])
  getAllFollowerActions() {
    return this.followerActionsService.findAll();
  }

  @Query(() => FollowerActionDetails, { nullable: true })
  findFollowerAction(@Args('id', { type: () => Int }) id: number) {
    return this.followerActionsService.findOne(id);
  }

  @Subscription(() => [FollowerAction], {
    name: SUBSCRIPTION_TOKEN.followerActionAdded,
  })
  subscribeToFollowerActionAdded() {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.followerActionAdded,
    );
  }
}
