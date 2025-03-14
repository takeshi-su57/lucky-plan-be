import { Module } from '@nestjs/common';
import { WalletAccountsService } from './wallet-accounts.service';
import { WalletAccountsResolver } from './wallet-accounts.resolver';
import { TagsResolver } from './tags.resolver';
import { TagsService } from './tags.service';
import { TagCategoriesService } from './tag-categories.service';
import { TagCategoriesResolver } from './tag-categories.resolver';

@Module({
  providers: [
    WalletAccountsResolver,
    TagsResolver,
    TagsService,
    WalletAccountsService,
    TagCategoriesService,
    TagCategoriesResolver,
  ],
  exports: [WalletAccountsService, TagsService, TagCategoriesService],
})
export class WalletAccountsModule {}
