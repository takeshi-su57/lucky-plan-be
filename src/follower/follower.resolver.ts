import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { PUB_SUB } from 'src/global/global.module';

import { FollowerService } from './follower.service';
import {
  ContractExecutionResult,
  Follower,
  FollowerDetail,
  FollowerPendingOrder,
  FollowerTrade,
} from './entities/follower.entity';
import {
  CloseTradeInput,
  CancelOrderAfterTimeoutInput,
  GetFollowerByAddressInput,
  WithdrawAllInput,
} from './dto/follower.input';

@Resolver(() => FollowerDetail)
export class FollowerResolver {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private readonly followerService: FollowerService,
  ) {}

  @Mutation(() => Follower)
  generateNewFollower() {
    return this.followerService.generateNewFollower();
  }

  @Mutation(() => Boolean)
  withdrawAllUSDC(@Args('input') input: WithdrawAllInput) {
    return this.followerService.withdrawAllUSDC(
      input.address,
      input.contractId,
    );
  }

  @Mutation(() => Boolean)
  withdrawAllETH(@Args('input') input: WithdrawAllInput) {
    return this.followerService.withdrawAllETH(input.address, input.contractId);
  }

  @Mutation(() => ContractExecutionResult)
  closeTradeMarket(@Args('input') input: CloseTradeInput) {
    return this.followerService.closeTradeMarket(input);
  }

  @Mutation(() => ContractExecutionResult)
  cancelOrderAfterTimeout(@Args('input') input: CancelOrderAfterTimeoutInput) {
    return this.followerService.cancelOrderAfterTimeout(input);
  }

  @Query(() => [FollowerPendingOrder])
  getPendingOrders(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.followerService.getPendingOrders(address, contractId);
  }

  @Query(() => [FollowerTrade])
  getTrades(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.followerService.getTrades(address, contractId);
  }

  @Query(() => String)
  getFollowerPrivateKey(@Args('input') input: GetFollowerByAddressInput) {
    return this.followerService.getPrivateKey(input.address);
  }

  @Query(() => [Follower])
  getAllFollowers() {
    return this.followerService.findAll();
  }

  @Query(() => [FollowerDetail])
  getAllFollowerDetails(
    @Args('contractId', { type: () => Int }) contractId: number,
  ) {
    return this.followerService.findAllDetails(contractId);
  }

  @Subscription(() => [FollowerDetail], {
    name: SUBSCRIPTION_TOKEN.followerDetailsUpdated,
    filter: (payload, variables) =>
      payload.followerDetailsUpdated.contractId === variables.contractId,
  })
  subscribeToMissionUpdated(
    @Args('contractId', { type: () => Int }) _contractId: number,
  ) {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.followerDetailsUpdated,
    );
  }
}
