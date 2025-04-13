import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { WalletAccountsService } from './wallet-accounts.service';
import { WalletAccount } from './entities/wallet-account.entity';
import {
  AddUserInput,
  ChangeUserTagInput,
  GetUserByAddressInput,
} from './dto/user.input';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/auth/user.decorator';
import { User } from 'src/auth/entities/auth.entity';
import { Roles } from 'src/auth/roles.decorator';
import { UserPermission } from '@prisma/client';
import { RolesGuard } from 'src/auth/gql-role.guard';

@Resolver(() => WalletAccount)
export class WalletAccountsResolver {
  constructor(private readonly walletAccountsService: WalletAccountsService) {}

  @Mutation(() => WalletAccount)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  addWalletAccount(
    @Args('input') input: AddUserInput,
    @CurrentUser() user: User,
  ) {
    return this.walletAccountsService.addWalletAccount(
      user.address,
      input.address,
    );
  }

  @Mutation(() => WalletAccount)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  addTagToWalletAccount(
    @Args('input') input: ChangeUserTagInput,
    @CurrentUser() user: User,
  ) {
    return this.walletAccountsService.addTag(user.address, input);
  }

  @Mutation(() => WalletAccount)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeTagFromWalletAccount(
    @Args('input') input: ChangeUserTagInput,
    @CurrentUser() user: User,
  ) {
    return this.walletAccountsService.removeTag(user.address, input);
  }

  @Query(() => WalletAccount)
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getWalletAccountByAddress(
    @Args('input') input: GetUserByAddressInput,
    @CurrentUser() user: User,
  ) {
    return this.walletAccountsService.getWalletAccountByAddress(
      user.address,
      input.address,
    );
  }

  @Query(() => [WalletAccount])
  @Roles(UserPermission.Trial)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getAllWalletAccounts(@CurrentUser() user: User) {
    return this.walletAccountsService.getAllWalletAccounts(user.address);
  }
}
