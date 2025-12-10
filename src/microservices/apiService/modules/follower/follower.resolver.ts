import { Resolver, Query, Mutation, Args, Int, Float } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { FollowerService } from './follower.service';
import {
  ContractExecutionResult,
  Follower,
  FollowerConnection,
  FollowerDetail,
} from './entities/follower.entity';
import {
  CloseTradeInput,
  CancelOrderAfterTimeoutInput,
  WithdrawAllInput,
  UpdateSlInput,
  UpdateTpInput,
  WithdrawPositivePnlInput,
  OpenTradeInput,
  UpdateLeverageInput,
  IncreasePositionSizeInput,
  DecreasePositionSizeInput,
  AssetInput,
} from './dto/follower.input';
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';
import { User } from 'src/microservices/apiService/modules/auth/entities/auth.entity';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from '@prisma/client';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';

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
  depositAsset(@Args('input') input: AssetInput, @CurrentUser() user: User) {
    return this.followerService.depositAsset(user.address, {
      address: input.address,
      contractId: input.contractId,
      amount: BigInt(input.amount),
      kind: input.kind as 'usdc' | 'eth',
    });
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  withdrawAsset(@Args('input') input: AssetInput, @CurrentUser() user: User) {
    return this.followerService.withdrawAsset(user.address, {
      address: input.address,
      contractId: input.contractId,
      amount: BigInt(input.amount),
      kind: input.kind as 'usdc' | 'eth',
    });
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
    @Args('password', { type: () => String }) password: string,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawETHToUser(
      user.address,
      password,
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
    @Args('password', { type: () => String }) password: string,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawUSDCToUser(
      user.address,
      password,
      amount,
      contractId,
    );
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  decreaseAllowanceToZero(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('followerAddress', { type: () => String }) followerAddress: string,
    @Args('password', { type: () => String }) password: string,
    @CurrentUser() user: User,
  ) {
    return this.followerService.decreaseAllowanceToZero(
      user.address,
      password,
      contractId,
      followerAddress,
    );
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  increaseAllowanceToMax(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('followerAddress', { type: () => String }) followerAddress: string,
    @Args('password', { type: () => String }) password: string,
    @CurrentUser() user: User,
  ) {
    return this.followerService.increaseAllowanceToMax(
      user.address,
      password,
      contractId,
      followerAddress,
    );
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  openTradeMarket(
    @Args('input') input: OpenTradeInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.openTradeMarket(user.address, input);
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updateLeverage(
    @Args('input') input: UpdateLeverageInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.updateLeverage(user.address, input);
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  increasePositionSize(
    @Args('input') input: IncreasePositionSizeInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.increasePositionSize(user.address, input);
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  decreasePositionSize(
    @Args('input') input: DecreasePositionSizeInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.decreasePositionSize(user.address, input);
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
  updateSl(@Args('input') input: UpdateSlInput, @CurrentUser() user: User) {
    return this.followerService.updateSl(user.address, input);
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  updateTp(@Args('input') input: UpdateTpInput, @CurrentUser() user: User) {
    return this.followerService.updateTp(user.address, input);
  }

  @Mutation(() => ContractExecutionResult)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  withdrawPositivePnl(
    @Args('input') input: WithdrawPositivePnlInput,
    @CurrentUser() user: User,
  ) {
    return this.followerService.withdrawPositivePnl(user.address, input);
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

  @Query(() => [Follower])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllFollowers(@CurrentUser() user: User) {
    return this.followerService.findAll(user.address);
  }

  @Query(() => FollowerConnection)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllFollowerDetails(
    @Args('contractId', { type: () => Int }) contractId: number,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
    @CurrentUser() user: User,
  ) {
    return this.followerService.findAllDetails(
      user.address,
      contractId,
      first,
      after,
    );
  }
}
