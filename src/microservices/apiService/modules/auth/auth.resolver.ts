import { Resolver, Mutation, Args, Query, Int, Float } from '@nestjs/graphql';
import { UserPermission } from 'generated/prisma/client';
import { UseGuards } from '@nestjs/common';

import { GqlAuthGuard } from './gql-auth.guard';
import { RolesGuard } from './gql-role.guard';
import { Roles } from './roles.decorator';

import { AuthService } from './auth.service';
import { AccessToken, User } from './entities/auth.entity';
@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Query(() => [User])
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllUsers() {
    return this.authService.getAllUsers();
  }

  @Mutation(() => User)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  changeUserPermission(
    @Args('address') address: string,
    @Args('permission') permission: UserPermission,
  ) {
    return this.authService.changePermission(address, permission);
  }

  @Mutation(() => User)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  allowAuto(
    @Args('address') address: string,
    @Args('allowAuto', { type: () => Boolean }) allowAuto: boolean,
    @Args('budget', { type: () => Float }) budget: number,
    @Args('ratio', { type: () => Float }) ratio: number,
    @Args('followerContractId', { type: () => Int })
    followerContractId: number,
  ) {
    return this.authService.allowAuto(
      address,
      allowAuto,
      budget,
      ratio,
      followerContractId,
    );
  }

  @Mutation(() => AccessToken)
  getToken(
    @Args('walletAddress') walletAddress: `0x${string}`,
    @Args('signature') signature: `0x${string}`,
    @Args('timestamp') timestamp: string,
  ) {
    return this.authService.getToken(walletAddress, signature, +timestamp);
  }
}
