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

@Resolver(() => WalletAccount)
export class WalletAccountsResolver {
  constructor(private readonly walletAccountsService: WalletAccountsService) {}

  @Mutation(() => WalletAccount)
  @UseGuards(GqlAuthGuard)
  addWalletAccount(@Args('input') input: AddUserInput) {
    return this.walletAccountsService.addWalletAccount(input.address);
  }

  @Mutation(() => WalletAccount)
  @UseGuards(GqlAuthGuard)
  addTagToWalletAccount(@Args('input') input: ChangeUserTagInput) {
    return this.walletAccountsService.addTag(input);
  }

  @Mutation(() => WalletAccount)
  @UseGuards(GqlAuthGuard)
  removeTagFromWalletAccount(@Args('input') input: ChangeUserTagInput) {
    return this.walletAccountsService.removeTag(input);
  }

  @Query(() => WalletAccount)
  @UseGuards(GqlAuthGuard)
  getWalletAccountByAddress(@Args('input') input: GetUserByAddressInput) {
    return this.walletAccountsService.getWalletAccountByAddress(input.address);
  }

  @Query(() => [WalletAccount])
  @UseGuards(GqlAuthGuard)
  getAllWalletAccounts() {
    return this.walletAccountsService.getAllWalletAccounts();
  }
}
