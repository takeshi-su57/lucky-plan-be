import { Inject } from '@nestjs/common';
import { Resolver, Query, Subscription, Args, Int } from '@nestjs/graphql';
import { ActionsService } from './actions.service';
import { Action } from './entities/action.entity';
import { PubSub } from 'graphql-subscriptions';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver(() => Action)
export class ActionsResolver {
  constructor(
    private readonly actionsService: ActionsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Query(() => [Action])
  getAllActions() {
    return this.actionsService.findAll();
  }

  @Query(() => [Action])
  findActionsByPosition(@Args('positionId') positionId: number) {
    return this.actionsService.findByPosition(positionId);
  }

  @Query(() => Action, { nullable: true })
  findAction(@Args('id', { type: () => Int }) id: number) {
    return this.actionsService.findOne(id);
  }

  @Subscription(() => [Action], {
    name: SUBSCRIPTION_TOKEN.actionAdded,
  })
  subscribeToActionAdded() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.actionAdded);
  }
}
