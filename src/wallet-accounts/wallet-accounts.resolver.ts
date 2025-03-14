import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { WalletAccountsService } from './wallet-accounts.service';
import { WalletAccount } from './entities/wallet-account.entity';
import {
  AddUserInput,
  ChangeUserTagInput,
  GetUserByAddressInput,
} from './dto/user.input';

@Resolver(() => WalletAccount)
export class WalletAccountsResolver {
  constructor(private readonly walletAccountsService: WalletAccountsService) {}

  @Mutation(() => WalletAccount)
  addWalletAccount(@Args('input') input: AddUserInput) {
    return this.walletAccountsService.addWalletAccount(input.address);
  }

  @Mutation(() => WalletAccount)
  addTagToWalletAccount(@Args('input') input: ChangeUserTagInput) {
    return this.walletAccountsService.addTag(input);
  }

  @Mutation(() => WalletAccount)
  removeTagFromWalletAccount(@Args('input') input: ChangeUserTagInput) {
    return this.walletAccountsService.removeTag(input);
  }

  @Query(() => WalletAccount)
  getWalletAccountByAddress(@Args('input') input: GetUserByAddressInput) {
    return this.walletAccountsService.getWalletAccountByAddress(input.address);
  }

  @Query(() => [WalletAccount])
  getAllWalletAccounts() {
    return this.walletAccountsService.getAllWalletAccounts();
  }
}
