import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
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
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';

@Resolver(() => FollowerDetail)
export class FollowerResolver {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private readonly followerService: FollowerService,
  ) {}

  @Mutation(() => Follower)
  @UseGuards(GqlAuthGuard)
  generateNewFollower() {
    return this.followerService.generateNewFollower();
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  withdrawAllUSDC(@Args('input') input: WithdrawAllInput) {
    return this.followerService.withdrawAllUSDC(
      input.address,
      input.contractId,
    );
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  withdrawAllETH(@Args('input') input: WithdrawAllInput) {
    return this.followerService.withdrawAllETH(input.address, input.contractId);
  }

  @Mutation(() => ContractExecutionResult)
  @UseGuards(GqlAuthGuard)
  closeTradeMarket(@Args('input') input: CloseTradeInput) {
    return this.followerService.closeTradeMarket(input);
  }

  @Mutation(() => ContractExecutionResult)
  @UseGuards(GqlAuthGuard)
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
  @UseGuards(GqlAuthGuard)
  getFollowerPrivateKey(@Args('input') input: GetFollowerByAddressInput) {
    return this.followerService.getPrivateKey(input.address);
  }

  @Query(() => [Follower])
  @UseGuards(GqlAuthGuard)
  getAllFollowers() {
    return this.followerService.findAll();
  }

  @Query(() => [FollowerDetail])
  @UseGuards(GqlAuthGuard)
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
  @UseGuards(GqlAuthGuard)
  subscribeToMissionUpdated(
    @Args('contractId', { type: () => Int }) _contractId: number,
  ) {
    return this.pubSub.asyncIterableIterator(
      SUBSCRIPTION_TOKEN.followerDetailsUpdated,
    );
  }
}
