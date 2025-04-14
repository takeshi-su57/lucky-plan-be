import { Resolver, Query, Mutation, Args, Int, Float } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

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
  WithdrawAllInput,
} from './dto/follower.input';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { CurrentUser } from 'src/auth/user.decorator';
import { User } from 'src/auth/entities/auth.entity';
import { Roles } from 'src/auth/roles.decorator';
import { UserPermission } from '@prisma/client';
import { RolesGuard } from 'src/auth/gql-role.guard';

@Resolver(() => FollowerDetail)
export class FollowerResolver {
  constructor(private readonly followerService: FollowerService) {}

  @Mutation(() => Follower)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  generateNewFollower(@CurrentUser() user: User) {
    return this.followerService.generateNewFollower(user.address);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  withdrawAllUSDC(
    @Args('input') input: WithdrawAllInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawAllUSDC(
      user.address,
      input.address,
      input.contractId,
    );
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  withdrawAllETH(
    @Args('input') input: WithdrawAllInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawAllETH(
      user.address,
      input.address,
      input.contractId,
    );
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  withdrawETHToUser(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('amount', { type: () => Float }) amount: number,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawETHToUser(
      user.address,
      amount,
      contractId,
    );
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  withdrawUSDCToUser(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('amount', { type: () => Float }) amount: number,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawUSDCToUser(
      user.address,
      amount,
      contractId,
    );
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  closeTradeMarket(
    @Args('input') input: CloseTradeInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.closeTradeMarket(user.address, input);
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  cancelOrderAfterTimeout(
    @Args('input') input: CancelOrderAfterTimeoutInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.cancelOrderAfterTimeout(user.address, input);
  }

  @Query(() => [FollowerPendingOrder])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getPendingOrders(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
    @CurrentUser() user: User,
  ) {
    return this.followerService.getPendingOrders(
      user.address,
      address,
      contractId,
    );
  }

  @Query(() => [FollowerTrade])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getTrades(
    @Args('address') address: string,
    @Args('contractId', { type: () => Int }) contractId: number,
    @CurrentUser() user: User,
  ) {
    return this.followerService.getTrades(user.address, address, contractId);
  }

  // @Query(() => String)
  // @Roles(UserPermission.Trader)
  // @UseGuards(GqlAuthGuard, RolesGuard)
  // getFollowerPrivateKey(
  //   @Args('input') input: GetFollowerByAddressInput,
  //   @CurrentUser() user: User,
  // ) {
  //   return this.followerService.getPrivateKey(user.address, input.address);
  // }

  @Query(() => [Follower])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllFollowers(@CurrentUser() user: User) {
    return this.followerService.findAll(user.address);
  }

  @Query(() => [FollowerDetail])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllFollowerDetails(
    @Args('contractId', { type: () => Int }) contractId: number,
    @CurrentUser() user: User,
  ) {
    return this.followerService.findAllDetails(user.address, contractId);
  }
}
