import { Resolver, Mutation, Args, Query } from '@nestjs/graphql';
import { UserPermission } from '@prisma/client';
import { UseGuards } from '@nestjs/common';

import { GqlAuthGuard } from './gql-auth.guard';
import { AuthService } from './auth.service';
import { AccessToken, User } from './entities/auth.entity';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Query(() => [User])
  @UseGuards(GqlAuthGuard)
  getAllUsers() {
    return this.authService.getAllUsers();
  }

  @Mutation(() => User)
  @UseGuards(GqlAuthGuard)
  changeUserPermission(
    @Args('address') address: string,
    @Args('permission') permission: UserPermission,
  ) {
    return this.authService.changePermission(address, permission);
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
